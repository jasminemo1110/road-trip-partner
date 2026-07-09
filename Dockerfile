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
# curl/ca-certificates 装 litestream 用；rclone 负责 uploads/branding 的对象存储备份
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip fonts-noto-cjk curl ca-certificates rclone \
    && rm -rf /var/lib/apt/lists/*

# Litestream：SQLite 实时复制到对象存储（见 litestream.yml / docker-entrypoint.sh）
ARG LITESTREAM_VERSION=0.5.14
# 发布资产用 x86_64 命名而 dpkg 输出 amd64，需要映射
RUN ARCH="$(dpkg --print-architecture)" \
    && case "$ARCH" in amd64) LS_ARCH=x86_64 ;; *) LS_ARCH="$ARCH" ;; esac \
    && curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-${LITESTREAM_VERSION}-linux-${LS_ARCH}.tar.gz" \
       | tar -xz -C /usr/local/bin litestream \
    && litestream version

COPY backend/requirements.txt ./backend/requirements.txt
RUN python3 -m pip install --no-cache-dir --break-system-packages -r backend/requirements.txt

COPY backend ./backend
COPY --from=frontend-build /app/frontend/dist ./frontend/dist
COPY --from=frontend-build /app/frontend/node_modules ./frontend/node_modules
COPY frontend/package*.json ./frontend/
COPY frontend/scripts ./frontend/scripts

COPY litestream.yml /etc/litestream.yml
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && mkdir -p /data

WORKDIR /app/backend
EXPOSE 8000

CMD ["/app/docker-entrypoint.sh"]
