FROM node:24-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM mcr.microsoft.com/playwright:v1.59.1-noble

ENV PYTHONUNBUFFERED=1 \
    DATA_DIR=/data \
    PORT=8000 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./backend/requirements.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages -r backend/requirements.txt

COPY backend ./backend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY --from=frontend-build /app/frontend/node_modules ./frontend/node_modules
COPY frontend/package*.json ./frontend/
COPY frontend/scripts ./frontend/scripts

RUN mkdir -p /data

WORKDIR /app/backend
EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
