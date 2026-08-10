import pytest
from pydantic import ValidationError

from app.core.config import Settings


def test_production_rejects_development_secrets() -> None:
    with pytest.raises(ValidationError):
        Settings(app_env="production", client_urls=["https://hr.example.com"])


def test_client_urls_accept_comma_separated_env_shape() -> None:
    settings = Settings(app_env="test", client_urls="https://one.example, https://two.example")
    assert settings.client_urls == ["https://one.example", "https://two.example"]


def test_client_urls_accept_comma_separated_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLIENT_URLS", "https://one.example,https://two.example")
    settings = Settings(app_env="test", _env_file=None)
    assert settings.client_urls == ["https://one.example", "https://two.example"]
