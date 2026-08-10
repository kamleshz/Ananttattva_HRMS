from fastapi.testclient import TestClient

from app.main import create_app


def test_health_contract() -> None:
    with TestClient(create_app(enable_lifespan=False)) as client:
        response = client.get("/api/health")
    assert response.status_code == 200
    payload = response.json()
    assert payload["success"] is True
    assert payload["message"] == "AT Connect API is healthy"
    assert payload["timestamp"]


def test_unknown_route_uses_safe_error_shape() -> None:
    with TestClient(create_app(enable_lifespan=False)) as client:
        response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.json() == {"success": False, "message": "Not Found", "details": []}
