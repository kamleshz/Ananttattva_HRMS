FROM node:22.12-bookworm-slim AS node_dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NODE_ENV=production \
    APP_ENV=production \
    ML_INTERNAL_PORT=7001 \
    BIOMETRIC_SERVICE_URL=http://127.0.0.1:7001 \
    REDIS_URL=redis://127.0.0.1:6379/0

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 redis-server \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system atconnect \
    && adduser --system --ingroup atconnect atconnect

WORKDIR /app

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

COPY --from=node_dependencies /usr/local/bin/node /usr/local/bin/node
COPY --from=node_dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY app ./app
COPY scripts ./scripts

RUN python -m app.scripts.download_face_models \
    && chmod +x ./scripts/start-combined.sh \
    && chown -R atconnect:atconnect /app

USER atconnect

# Render exposes only the Node API. FastAPI and Redis stay container-local.
EXPOSE 10000

HEALTHCHECK --interval=30s --timeout=8s --start-period=45s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.getenv('PORT', '10000') + '/api/ready', timeout=5)"

CMD ["./scripts/start-combined.sh"]
