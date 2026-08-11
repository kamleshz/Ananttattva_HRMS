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
from app.ml.face_engine import UniFaceEngine
from app.repositories.biometrics import EmbeddingCipher


def image_data() -> str:
    random = np.random.default_rng(7)
    image = random.integers(70, 200, size=(480, 640, 3), dtype=np.uint8)
    ok, encoded = cv2.imencode(".jpg", image)
    assert ok
    return "data:image/jpeg;base64," + base64.b64encode(encoded).decode()


def engine_with(faces: list[SimpleNamespace]) -> UniFaceEngine:
    engine = UniFaceEngine.__new__(UniFaceEngine)
    engine.settings = Settings(app_env="test", face_min_quality=0.1, _env_file=None)
    engine.analyzer = SimpleNamespace(analyze=lambda _image: faces)
    engine.anti_spoof = None
    return engine


def error_code(error: AppError) -> str:
    return error.details[0]["code"]


def test_analyze_rejects_no_face_and_multiple_faces() -> None:
    with pytest.raises(AppError) as missing:
        engine_with([]).analyze(image_data())
    assert error_code(missing.value) == "FACE_NOT_DETECTED"

    face = SimpleNamespace(embedding=np.ones(512), bbox=np.array([120, 70, 520, 430]), confidence=0.99)
    with pytest.raises(AppError) as multiple:
        engine_with([face, face]).analyze(image_data())
    assert error_code(multiple.value) == "MULTIPLE_FACES"


def test_embedding_is_normalized_and_similarity_is_cosine() -> None:
    face = SimpleNamespace(embedding=np.arange(1, 513), bbox=np.array([120, 70, 520, 430]), confidence=0.99)
    engine = engine_with([face])
    analysis = engine.analyze(image_data())
    assert analysis.embedding.shape == (512,)
    assert np.linalg.norm(analysis.embedding) == pytest.approx(1.0)
    assert engine.compare_embeddings(analysis.embedding, analysis.embedding) == pytest.approx(1.0)


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
