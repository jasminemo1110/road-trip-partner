#!/bin/bash
# 启动后端和前端开发服务器
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "▶ 启动后端 (FastAPI @ http://localhost:8000)"
cd "$ROOT/backend"
uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo "▶ 启动前端 (Vite @ http://localhost:5173)"
cd "$ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

echo "✅ 服务已启动"
echo "   前端: http://localhost:5173"
echo "   API:  http://localhost:8000/api"
echo ""
echo "按 Ctrl+C 停止所有服务"
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
