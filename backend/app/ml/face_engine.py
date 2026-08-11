import base64
import logging
import math
import os
import time
from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

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
    def analyze(self, image_data: str | bytes) -> FaceAnalysis: ...
    def compare_embeddings(self, left: np.ndarray, right: np.ndarray) -> float: ...


class UniFaceEngine:
    engine_name = "uniface"
    embedding_dimension = 512

    def __init__(self, settings: Settings) -> None:
        from uniface import FaceAnalyzer
        from uniface.constants import ArcFaceWeights, SCRFDWeights
        from uniface.detection import SCRFD
        from uniface.recognition import ArcFace

        detector_model = {
            "scrfd_10g": SCRFDWeights.SCRFD_10G_KPS,
            "scrfd_500m": SCRFDWeights.SCRFD_500M_KPS,
        }[settings.face_detector]
        recognizer_model = {
            "arcface_mnet": ArcFaceWeights.MNET,
            "arcface_resnet": ArcFaceWeights.RESNET,
        }[settings.face_recognizer]
        providers = ["CPUExecutionProvider"]
        detector = SCRFD(model_name=detector_model, providers=providers)
        recognizer = ArcFace(model_name=recognizer_model, providers=providers)
        self.analyzer = FaceAnalyzer(detector=detector, recognizer=recognizer)
        self.anti_spoof = None
        if settings.face_anti_spoof_enabled:
            from uniface.spoofing import MiniFASNet

            self.anti_spoof = MiniFASNet(providers=providers)
        self.settings = settings

    @staticmethod
    def decode_image(image_data: str | bytes) -> np.ndarray:
        if isinstance(image_data, str):
            if not image_data.startswith("data:image/") or "," not in image_data:
                raise AppError(422, "The captured image format is invalid", [{"code": "IMAGE_FORMAT_INVALID"}])
            try:
                raw = base64.b64decode(image_data.split(",", 1)[1], validate=True)
            except (ValueError, TypeError) as exc:
                raise AppError(422, "The captured image could not be decoded", [{"code": "IMAGE_FORMAT_INVALID"}]) from exc
        else:
            raw = image_data
        if not raw or len(raw) > 4_500_000:
            raise AppError(422, "The captured image is empty or too large", [{"code": "IMAGE_SIZE_INVALID"}])
        image = cv2.imdecode(np.frombuffer(raw, dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            raise AppError(422, "The captured image could not be processed", [{"code": "IMAGE_FORMAT_INVALID"}])
        height, width = image.shape[:2]
        scale = min(1.0, 1280 / max(height, width))
        return cv2.resize(image, (round(width * scale), round(height * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else image

    def analyze(self, image_data: str | bytes) -> FaceAnalysis:
        image = self.decode_image(image_data)
        height, width = image.shape[:2]
        if width < 320 or height < 240:
            raise AppError(422, "Camera resolution is too low", [{"code": "IMAGE_QUALITY_LOW"}])
        faces = self.analyzer.analyze(image)
        if not faces:
            raise AppError(422, "No face was detected. Move closer and try again.", [{"code": "FACE_NOT_DETECTED"}])
        if len(faces) != 1:
            raise AppError(422, "More than one face was detected.", [{"code": "MULTIPLE_FACES"}])
        face = faces[0]
        if face.embedding is None or face.embedding.size != self.embedding_dimension:
            raise AppError(422, "A face template could not be generated", [{"code": "FACE_EMBEDDING_FAILED"}])
        x1, y1, x2, y2 = (int(value) for value in face.bbox)
        crop = image[max(0, y1):min(height, y2), max(0, x1):min(width, x2)]
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.size else np.empty((0, 0), dtype=np.uint8)
        brightness = float(np.mean(gray)) if gray.size else 0.0
        blur = float(cv2.Laplacian(gray, cv2.CV_64F).var()) if gray.size else 0.0
        face_ratio = max(0.0, (x2 - x1) * (y2 - y1) / float(width * height))
        brightness_score = max(0.0, 1.0 - abs(brightness - 135.0) / 135.0)
        blur_score = min(1.0, blur / 120.0)
        size_score = min(1.0, face_ratio / 0.18)
        score = round(0.35 * brightness_score + 0.35 * blur_score + 0.30 * size_score, 4)
        quality = FaceQuality(score >= self.settings.face_min_quality and 45 <= brightness <= 220 and face_ratio >= 0.06, score, brightness, blur, face_ratio)
        if not quality.passed:
            message = "Your face is too far from the camera." if face_ratio < 0.06 else "Lighting or image sharpness is too low. Retake the photo."
            raise AppError(422, message, [{"code": "IMAGE_QUALITY_LOW", "qualityScore": score}])
        anti_passed = anti_confidence = None
        if self.anti_spoof is not None:
            result = self.anti_spoof.predict(image, face.bbox)
            anti_confidence = float(result.confidence)
            anti_passed = bool(result.is_real and anti_confidence >= self.settings.face_anti_spoof_threshold)
            if not anti_passed:
                raise AppError(422, "The capture did not pass anti-spoofing checks", [{"code": "ANTI_SPOOF_FAILED"}])
        embedding = np.asarray(face.embedding, dtype=np.float32).reshape(-1)
        norm = float(np.linalg.norm(embedding))
        if not math.isfinite(norm) or norm <= 0:
            raise AppError(422, "A face template could not be generated", [{"code": "FACE_EMBEDDING_FAILED"}])
        return FaceAnalysis(embedding / norm, quality, float(face.confidence), (x1, y1, x2, y2), anti_passed, anti_confidence)

    @staticmethod
    def compare_embeddings(left: np.ndarray, right: np.ndarray) -> float:
        left = np.asarray(left, dtype=np.float32).reshape(-1)
        right = np.asarray(right, dtype=np.float32).reshape(-1)
        if left.shape != right.shape or left.size == 0:
            raise ValueError("Embedding dimensions do not match")
        return float(np.dot(left / np.linalg.norm(left), right / np.linalg.norm(right)))


class FaceEngineManager:
    def __init__(self) -> None:
        self.engine: UniFaceEngine | None = None
        self.error: str | None = None
        self.loaded_at: float | None = None

    def initialize(self, settings: Settings) -> None:
        try:
            if settings.face_model_cache_dir:
                os.environ["UNIFACE_CACHE_DIR"] = settings.face_model_cache_dir
            started = time.perf_counter()
            self.engine = UniFaceEngine(settings)
            self.loaded_at = time.time()
            self.error = None
            logger.info("face_engine_loaded", extra={"context": {"model": settings.face_model_version, "duration_ms": round((time.perf_counter()-started)*1000, 2)}})
        except Exception as exc:
            self.engine = None
            self.error = f"{type(exc).__name__}: {exc}"
            logger.exception("face_engine_load_failed")

    def get(self) -> UniFaceEngine:
        if self.engine is None:
            raise AppError(503, "Face verification is temporarily unavailable. Use the approved manual attendance option.", [{"code": "FACE_ENGINE_UNAVAILABLE"}])
        return self.engine

    def close(self) -> None:
        self.engine = None

    def health(self) -> dict[str, object]:
        return {"healthy": self.engine is not None, "modelLoaded": self.engine is not None, "errorCode": None if self.engine else "FACE_MODEL_NOT_LOADED"}


face_engine_manager = FaceEngineManager()
