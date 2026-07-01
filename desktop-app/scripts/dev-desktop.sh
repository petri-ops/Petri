#!/bin/bash
# ============================================================
# dev-desktop.sh — 桌面版一键构建启动
#
# 用法：
#   ./dev-desktop.sh            # 默认：清进程 + build SPA + build Docusaurus + 启动
#   ./dev-desktop.sh --quick    # 快速：只清进程 + 启动（跳过 build，用现有产物）
#   ./dev-desktop.sh --spa-only # 只 build SPA（Docusaurus 产物已存在）
#
# 适合 Claude Code 直接执行：改完代码后跑这个，Electron 就用最新产物启动。
# ============================================================

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DESKTOP_APP="$PROJECT_ROOT/desktop-app"
FRONTEND="$DESKTOP_APP/frontend"
BUILD_DIR="$PROJECT_ROOT/build"

QUICK=false
SPA_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=true ;;
    --spa-only) SPA_ONLY=true ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

echo "🧹 清理残留进程（端口 3001-3004 + electron + r/py-server）..."
lsof -ti:3001,3002,3003,3004 2>/dev/null | xargs kill -9 2>/dev/null || true
pkill -9 -f "desktop-app/node_modules/electron" 2>/dev/null || true
pkill -9 -f "r-server/server.js" 2>/dev/null || true
pkill -9 -f "py-server/server.js" 2>/dev/null || true
sleep 1
echo "   残留进程: $(ps aux | grep -E 'electron|r-server|py-server' | grep -v grep | grep -v claude | wc -l | tr -d ' ')"

if [ "$QUICK" = true ]; then
  echo "⚡ 快速模式：跳过 build，直接启动"
else
  echo "🔨 构建 Vite SPA..."
  cd "$FRONTEND"
  npm run build
  echo "   SPA 产物: $FRONTEND/dist ($(du -sh dist | cut -f1))"

  if [ "$SPA_ONLY" = false ]; then
    echo "🔨 构建 Docusaurus（docs/blog iframe 源）..."
    cd "$PROJECT_ROOT"
    npm run build:desktop 2>&1 | tail -2
    echo "   Docusaurus 产物: $BUILD_DIR ($(du -sh build | cut -f1))"
  fi
fi

echo "🚀 启动 Electron..."
cd "$DESKTOP_APP"
# 后台启动，日志输出到终端
npm start
