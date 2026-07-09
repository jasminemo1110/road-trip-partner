#!/bin/sh
# 容器入口：有对象存储配置时以「Litestream 包裹 uvicorn + rclone 周期同步」
# 方式启动，实现 DB 实时复制 + 上传文件备份；没配置时直接裸跑 uvicorn，
# 开源用户 / 本地调试不受影响。
set -e

UVICORN_CMD="uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"

if [ -z "$BUCKET_NAME" ] || [ -z "$AWS_ACCESS_KEY_ID" ]; then
  echo "[backup] BUCKET_NAME / AWS_ACCESS_KEY_ID 未配置，跳过备份复制，直接启动应用"
  exec $UVICORN_CMD
fi

echo "[backup] Litestream 复制已启用 → bucket ${BUCKET_NAME}"

# 空卷（volume 损坏重建、迁移区域）时自动从副本恢复最新数据库；
# 正常启动时 DB 已存在，这一步是 no-op。
litestream restore -if-db-not-exists -if-replica-exists /data/travel.db || \
  echo "[backup] litestream restore 跳过或失败（首次部署 bucket 为空时属正常）"

# uploads（照片/二维码）和 branding 不是 SQLite，Litestream 管不了，
# 用 rclone 周期增量同步。凭证复用同一组 AWS_* 环境变量。
export RCLONE_CONFIG_RTPBACKUP_TYPE=s3
export RCLONE_CONFIG_RTPBACKUP_PROVIDER=Other
export RCLONE_CONFIG_RTPBACKUP_ENV_AUTH=true
export RCLONE_CONFIG_RTPBACKUP_ENDPOINT="$AWS_ENDPOINT_URL_S3"

mkdir -p /data/uploads /data/branding
(
  while true; do
    rclone sync /data/uploads "rtpbackup:${BUCKET_NAME}/files/uploads" -q \
      || echo "[backup] uploads 同步失败，下一轮重试"
    rclone sync /data/branding "rtpbackup:${BUCKET_NAME}/files/branding" -q \
      || echo "[backup] branding 同步失败，下一轮重试"
    sleep "${FILE_BACKUP_INTERVAL:-600}"
  done
) &

# litestream 以子进程方式托管 uvicorn：收到停机信号会先转发给应用，
# 应用退出后完成最后一次同步再退出，配合 Fly auto-stop 不丢尾部写入。
exec litestream replicate -exec "$UVICORN_CMD"
