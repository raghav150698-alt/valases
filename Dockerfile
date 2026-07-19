FROM node:22-bookworm-slim AS assessment-build

WORKDIR /src/app/web_assessment_react
COPY app/web_assessment_react/package*.json ./
RUN npm install
COPY app/web_assessment_react/ ./
RUN npm run build

FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-ml.txt ./
RUN python -m pip install --upgrade pip \
    && pip install -r requirements.txt \
    && pip install -r requirements-ml.txt

COPY app ./app
COPY api ./api
COPY ml ./ml
COPY data/proctoring/models ./data/proctoring/models
COPY --from=assessment-build /src/app/web_assessment_react/dist ./app/web_assessment_react/dist

RUN mkdir -p /app/app/web/media /app/logs

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
