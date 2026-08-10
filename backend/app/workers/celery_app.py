from celery import Celery

from app.core.config import get_settings

settings = get_settings()
redis_url = settings.redis_url.get_secret_value()

celery_app = Celery("at_connect", broker=redis_url, backend=redis_url, include=[])
celery_app.conf.update(
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    result_expires=86_400,
)
