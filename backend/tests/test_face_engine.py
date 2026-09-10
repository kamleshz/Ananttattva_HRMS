import base64
from types import SimpleNamespace

import cv2
import numpy as np
import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.core.database import get_database
from app.core.errors import AppError
from app.main import create_app
from app.ml.face_engine import MiniFASNetV2, YuNetSFaceEngine
from app.repositories.biometrics import EmbeddingCipher


def image_data() -> str:
    random = np.random.default_rng(7)
    image = random.integers(70, 200, size=(480, 640, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return "data:image/jpeg;base64," + base64.b64encode(encoded).decode()


def engine_with(faces: list[np.ndarray]) -> YuNetSFaceEngine:
    engine = YuNetSFaceEngine.__new__(YuNetSFaceEngine)
    engine.settings = Settings(app_env="test", face_min_quality=0.1, face_min_blur_variance=0, _env_file=None)
    engine.detector = SimpleNamespace(
        setInputSize=lambda _size: None, detect=lambda _image: (None, np.asarray(faces) if faces else None)
    )
    engine.recognizer = SimpleNamespace(
        alignCrop=lambda image, _face: image, feature=lambda _image: np.arange(1, 129, dtype=np.float32)[None, :]
    )
    engine.anti_spoof = None
    return engine


def error_code(error: AppError) -> str:
    return error.details[0]["code"]


def test_analyze_rejects_no_face_and_multiple_faces() -> None:
    with pytest.raises(AppError) as missing:
        engine_with([]).analyze(image_data())
    assert error_code(missing.value) == "NO_FACE_DETECTED"

    face = np.array([120, 70, 400, 360, 180, 160, 400, 160, 290, 250, 210, 340, 370, 340, 0.99], dtype=np.float32)
    with pytest.raises(AppError) as multiple:
        engine_with([face, face]).analyze(image_data())
    assert error_code(multiple.value) == "MULTIPLE_FACES_DETECTED"


def test_embedding_is_normalized_and_similarity_is_cosine() -> None:
    face = np.array([120, 70, 400, 360, 180, 160, 400, 160, 290, 250, 210, 340, 370, 340, 0.99], dtype=np.float32)
    engine = engine_with([face])
    analysis = engine.analyze(image_data())
    assert analysis.embedding.shape == (128,)
    assert np.linalg.norm(analysis.embedding) == pytest.approx(1.0)
    assert engine.compare_embeddings(analysis.embedding, analysis.embedding) == pytest.approx(1.0)


def test_minifas_uses_exported_raw_bgr_input_and_real_class() -> None:
    captured: list[np.ndarray] = []
    adapter = MiniFASNetV2.__new__(MiniFASNetV2)
    adapter.input_name = "input"
    adapter.height = adapter.width = 80
    adapter.threshold = 0.5
    adapter.real_class_index = 1
    adapter.session = SimpleNamespace(
        run=lambda _outputs, inputs: captured.append(inputs["input"]) or [np.array([[0.1, 2.0, 0.2]])]
    )
    image = np.full((100, 100, 3), 200, dtype=np.uint8)

    passed, score = adapter.predict(image, (20, 20, 60, 60))

    assert passed is True
    assert score > 0.5
    assert captured[0].shape == (1, 3, 80, 80)
    assert captured[0].dtype == np.float32
    assert captured[0].min() == captured[0].max() == 200.0


def test_encrypted_embedding_round_trip() -> None:
    key = Fernet.generate_key().decode()
    cipher = EmbeddingCipher(Settings(app_env="test", face_embedding_key=key, _env_file=None))
    source = np.array([0.125, -0.75, 0.5], dtype=np.float32)
    encrypted = cipher.encrypt(source)
    assert "0.125" not in encrypted
    assert np.allclose(cipher.decrypt(encrypted), source)


def test_biometric_endpoint_requires_authentication() -> None:
    app = create_app(enable_lifespan=False)
    app.dependency_overrides[get_database] = object
    with TestClient(app) as client:
        response = client.get("/api/biometrics/me/status")
    assert response.status_code == 401
