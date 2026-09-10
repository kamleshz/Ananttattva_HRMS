import base64
import logging
import math
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import cv2
import numpy as np
import onnxruntime as ort

from app.core.config import Settings
from app.core.errors import AppError

logger = logging.getLogger("at_connect.face_engine")


@dataclass(frozen=True)
class FaceQuality:
    passed: bool
    score: float
    brightness: float
    blur_variance: float
    face_ratio: float


@dataclass(frozen=True)
class FaceAnalysis:
    embedding: np.ndarray
    quality: FaceQuality
    confidence: float
    bbox: tuple[int, int, int, int]
    anti_spoof_passed: bool | None = None
    anti_spoof_confidence: float | None = None


class FaceVerificationEngine(Protocol):
    def analyze(self, image_data: str | bytes, *, require_liveness: bool = False) -> FaceAnalysis: ...
    def compare_embeddings(self, left: np.ndarray, right: np.ndarray) -> float: ...


class MiniFASNetV2:
    """ONNX PAD adapter; the real-class output index is configurable per export."""

    def __init__(self, model_path: str, threshold: float, real_class_index: int) -> None:
        self.session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        model_input = self.session.get_inputs()[0]
        self.input_name = model_input.name
        shape = model_input.shape
        self.height = int(shape[-2]) if isinstance(shape[-2], int) else 80
        self.width = int(shape[-1]) if isinstance(shape[-1], int) else 80
        self.threshold = threshold
        self.real_class_index = real_class_index

    def predict(self, image: np.ndarray, bbox: tuple[int, int, int, int]) -> tuple[bool, float]:
        x1, y1, x2, y2 = bbox
        h, w = image.shape[:2]
        box_w, box_h = x2 - x1, y2 - y1
        crop_w, crop_h = box_w * 2.7, box_h * 2.7
        center_x, center_y = (x1 + x2) / 2, (y1 + y2) / 2
        crop = image[
            max(0, int(center_y - crop_h / 2)) : min(h, int(center_y + crop_h / 2)),
            max(0, int(center_x - crop_w / 2)) : min(w, int(center_x + crop_w / 2)),
        ]
        if crop.size == 0:
            return False, 0.0
        blob = cv2.resize(crop, (self.width, self.height)).astype(np.float32)
        blob = np.transpose((blob - 127.5) / 128.0, (2, 0, 1))[None, ...]
        logits = np.asarray(self.session.run(None, {self.input_name: blob})[0], dtype=np.float32).reshape(-1)
        logits -= np.max(logits)
        probabilities = np.exp(logits) / np.sum(np.exp(logits))
        if self.real_class_index >= probabilities.size:
            raise RuntimeError("FACE_ANTI_SPOOF_REAL_CLASS_INDEX exceeds model output")
        score = float(probabilities[self.real_class_index])
        return score >= self.threshold, score


class YuNetSFaceEngine:
    engine_name = "opencv_sface"
    embedding_dimension = 128

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        for name, model_path in (("YuNet", settings.face_yunet_model_path), ("SFace", settings.face_sface_model_path)):
            if not Path(model_path).is_file():
                raise FileNotFoundError(f"{name} model not found at {model_path}")
        self.detector = cv2.FaceDetectorYN.create(
            settings.face_yunet_model_path,
            "",
            (320, 320),
            settings.face_detection_threshold,
            settings.face_nms_threshold,
            5000,
        )
        self.recognizer = cv2.FaceRecognizerSF.create(settings.face_sface_model_path, "")
        self.anti_spoof = None
        if settings.face_anti_spoof_enabled:
            if not Path(settings.face_anti_spoof_model_path).is_file():
                raise FileNotFoundError(f"MiniFASNetV2 model not found at {settings.face_anti_spoof_model_path}")
            self.anti_spoof = MiniFASNetV2(
                settings.face_anti_spoof_model_path,
                settings.face_anti_spoof_threshold,
                settings.face_anti_spoof_real_class_index,
            )

    @staticmethod
    def decode_image(image_data: str | bytes) -> np.ndarray:
        if isinstance(image_data, str):
            if not image_data.startswith(
                ("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")
            ):
                raise AppError(422, "The captured image format is invalid", [{"code": "IMAGE_FORMAT_INVALID"}])
            try:
                raw = base64.b64decode(image_data.split(",", 1)[1], validate=True)
            except (ValueError, TypeError) as exc:
                raise AppError(
                    422, "The captured image could not be decoded", [{"code": "IMAGE_FORMAT_INVALID"}]
                ) from exc
        else:
            raw = image_data
        if not raw or len(raw) > 4_500_000:
            raise AppError(422, "The captured image is empty or too large", [{"code": "IMAGE_SIZE_INVALID"}])
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise AppError(422, "The captured image could not be processed", [{"code": "IMAGE_FORMAT_INVALID"}])
        h, w = image.shape[:2]
        scale = min(1.0, 1280 / max(h, w))
        return (
            cv2.resize(image, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA)
            if scale < 1
            else image
        )

    def analyze(self, image_data: str | bytes, *, require_liveness: bool = False) -> FaceAnalysis:
        image = self.decode_image(image_data)
        height, width = image.shape[:2]
        if width < 320 or height < 240:
            raise AppError(422, "Camera resolution is too low", [{"code": "IMAGE_QUALITY_LOW"}])
        self.detector.setInputSize((width, height))
        _, detected = self.detector.detect(image)
        faces = [] if detected is None else detected
        if len(faces) == 0:
            raise AppError(422, "No face was detected. Move closer and try again.", [{"code": "NO_FACE_DETECTED"}])
        if len(faces) != 1:
            raise AppError(422, "More than one face was detected.", [{"code": "MULTIPLE_FACES_DETECTED"}])
        face = np.asarray(faces[0], dtype=np.float32)
        x, y, box_w, box_h = (int(v) for v in face[:4])
        x1, y1, x2, y2 = max(0, x), max(0, y), min(width, x + box_w), min(height, y + box_h)
        crop = image[y1:y2, x1:x2]
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.size else np.empty((0, 0), dtype=np.uint8)
        brightness = float(np.mean(gray)) if gray.size else 0.0
        blur = float(cv2.Laplacian(gray, cv2.CV_64F).var()) if gray.size else 0.0
        face_ratio = max(0.0, box_w * box_h / float(width * height))
        if face_ratio < self.settings.face_min_ratio:
            raise AppError(422, "Your face is too far from the camera.", [{"code": "FACE_TOO_SMALL"}])
        brightness_score = max(0.0, 1.0 - abs(brightness - 135.0) / 135.0)
        blur_score = min(1.0, blur / max(1.0, self.settings.face_min_blur_variance))
        size_score = min(1.0, face_ratio / 0.18)
        score = round(0.35 * brightness_score + 0.35 * blur_score + 0.30 * size_score, 4)
        quality = FaceQuality(
            score >= self.settings.face_min_quality
            and self.settings.face_min_brightness <= brightness <= self.settings.face_max_brightness
            and blur >= self.settings.face_min_blur_variance,
            score,
            brightness,
            blur,
            face_ratio,
        )
        if not quality.passed:
            raise AppError(
                422,
                "Lighting or image sharpness is too low. Retake the photo.",
                [{"code": "IMAGE_QUALITY_LOW", "qualityScore": score}],
            )
        anti_passed = anti_confidence = None
        if require_liveness:
            if self.anti_spoof is None:
                raise AppError(503, "Liveness verification is unavailable", [{"code": "BIOMETRIC_SERVICE_UNAVAILABLE"}])
            anti_passed, anti_confidence = self.anti_spoof.predict(image, (x1, y1, x2, y2))
            if not anti_passed:
                raise AppError(
                    422,
                    "The capture did not pass liveness checks",
                    [{"code": "LIVENESS_FAILED", "score": round(anti_confidence, 4)}],
                )
        aligned = self.recognizer.alignCrop(image, face)
        embedding = np.asarray(self.recognizer.feature(aligned), dtype=np.float32).reshape(-1)
        if embedding.size != self.embedding_dimension:
            raise AppError(422, "A face template could not be generated", [{"code": "FACE_EMBEDDING_FAILED"}])
        norm = float(np.linalg.norm(embedding))
        if not math.isfinite(norm) or norm <= 0:
            raise AppError(422, "A face template could not be generated", [{"code": "FACE_EMBEDDING_FAILED"}])
        return FaceAnalysis(embedding / norm, quality, float(face[14]), (x1, y1, x2, y2), anti_passed, anti_confidence)

    @staticmethod
    def compare_embeddings(left: np.ndarray, right: np.ndarray) -> float:
        left, right = np.asarray(left, dtype=np.float32).reshape(-1), np.asarray(right, dtype=np.float32).reshape(-1)
        if left.shape != right.shape or left.size == 0:
            raise ValueError("Embedding dimensions do not match")
        return float(np.dot(left / np.linalg.norm(left), right / np.linalg.norm(right)))


class FaceEngineManager:
    def __init__(self) -> None:
        self.engine: YuNetSFaceEngine | None = None
        self.error: str | None = None
        self.loaded_at: float | None = None

    def initialize(self, settings: Settings) -> None:
        try:
            started = time.perf_counter()
            self.engine = YuNetSFaceEngine(settings)
            self.loaded_at, self.error = time.time(), None
            logger.info(
                "face_engine_loaded",
                extra={
                    "context": {
                        "engine": self.engine.engine_name,
                        "model": settings.face_model_version,
                        "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                    }
                },
            )
        except Exception as exc:
            self.engine, self.error = None, f"{type(exc).__name__}: {exc}"
            logger.exception("face_engine_load_failed")

    def get(self) -> YuNetSFaceEngine:
        if self.engine is None:
            raise AppError(
                503,
                "Face verification is temporarily unavailable. Use the approved manual attendance option.",
                [{"code": "BIOMETRIC_SERVICE_UNAVAILABLE"}],
            )
        return self.engine

    def close(self) -> None:
        self.engine = None

    def health(self) -> dict[str, object]:
        loaded = self.engine is not None
        return {
            "healthy": loaded,
            "engine": "opencv_sface",
            "yunetLoaded": loaded,
            "sfaceLoaded": loaded,
            "livenessLoaded": bool(loaded and self.engine and self.engine.anti_spoof),
            "modelLoaded": loaded,
            "errorCode": None if loaded else "FACE_MODEL_NOT_LOADED",
        }


face_engine_manager = FaceEngineManager()
