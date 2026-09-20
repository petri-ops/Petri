#!/usr/bin/env bash
# platform: dual（BLOCK-104 P4 双端同形门）
# BLOCK-100 P2 — 启动 CDP 测试实例（独立 userData + 离屏可见窗口 + CDP 9223）。
#
# 与用户主实例并存：测试实例零 fork 后端、零 migration，直连主 dev 栈的
# biof3-server（默认 :3001，R_SERVER_PORT 指定）。userData 独立 ⇒ 单实例锁
# 不冲突；主进程按 ?test=1 标记加载渲染层，CDP 探针据此选目标（永久红线：
# 探针禁止导航用户窗口）。
#
# 前置：主 dev 栈在跑（后端 :3001 健康否则 fail-fast）。
# 用法: bash scripts/start-test-instance.sh [--onscreen]
#   --onscreen  窗口摆屏幕内（观察测试过程）；默认离屏（不挡视线）。
#   窗口亦可随时拖动/经渲染层 window.moveTo 移动；勿最小化（渲染冻结会挂测试断言）。
# 就绪: 退出 0 = 测试实例 CDP 9223 已出现 ?test=1 页面目标。
#
# 双端同形（BLOCK-88 P1 会话沉淀，2026-09-19）：原版为纯 Windows 实现
# （netstat/taskkill/PowerShell Start-Process/D 盘硬编码路径），macOS 上
# 杀场与启动段双双静默空转（症状指纹=脚本走完打印 TIMEOUT 但
# .biof3-test-instance.err.log 根本不存在）。现按 uname 分支：Windows 段
# 原样保留；darwin 段=lsof 定点杀（SKILL 第 8 条 ⑦ 禁 pkill）+ nohup 直启
# electron/cli.js（无 launch token 亦可——token 仅 dev-electron pgrep 定位用，
# main.js 不校验）。数据目录双端各取本仓 .biof3-dev-user-data 相对路径。
set -u
cd "$(dirname "$0")/.." || exit 2

# ── 参数解析 ──
for arg in "$@"; do
  case "$arg" in
    --onscreen) export BIOF3_TEST_ONSCREEN=1 ;;
    *) echo "未知参数: $arg（支持 --onscreen）"; exit 2 ;;
  esac
done

# 1) 前置断言：后端必须已在跑（测试实例零 fork，缺席即 fail-fast）
port="${BIOF3_TEST_BACKEND_PORT:-3001}"
code=$(curl -s -m 3 "http://127.0.0.1:${port}/api/health" -w '\n%{http_code}' 2>/dev/null | tail -n1)
if [ "${code}" != "200" ]; then
  echo "FAIL: backend :${port} not reachable (http ${code:-none}) —— 请先启动主 dev 栈（npm run dev 或 restart-dev-stack.sh）"
  exit 2
fi
echo "backend :${port} healthy"

# 2) 幂等清场：只杀 9223 监听者（测试实例自身），绝不碰主实例 electron
if [ "$(uname -s)" = "Darwin" ]; then
  occ=$(lsof -tnP -iTCP:9223 -sTCP:LISTEN 2>/dev/null | head -1)
  if [ -n "${occ:-}" ]; then
    echo "kill stale test instance on 9223 (pid ${occ})"
    kill "${occ}" >/dev/null 2>&1 || true
    sleep 2
  fi
  if lsof -tnP -iTCP:9223 -sTCP:LISTEN 2>/dev/null | grep -q .; then
    echo "ABORT: port 9223 still held after kill"; exit 3
  fi
else
  occ=$(netstat -ano | grep ':9223' | grep LISTENING | awk '{print $5}' | head -1)
  if [ -n "${occ:-}" ]; then
    echo "kill stale test instance on 9223 (pid ${occ})"
    MSYS_NO_PATHCONV=1 taskkill /PID "${occ}" /F >/dev/null 2>&1 || true
    sleep 2
  fi
  occ9223=$(netstat -ano | grep ':9223' | grep LISTENING | head -1 || true)
  if [ -n "${occ9223}" ]; then echo "ABORT: port 9223 still held after kill"; exit 3; fi
fi

# 3) 环境注入（userData 独立 ⇒ 单实例锁不冲突；DB/数据根与主实例同源）
export BIOF3_TEST_INSTANCE=1
export BIOF3_ELECTRON_USER_DATA_DIR="$(pwd)/.biof3-test-user-data"
mkdir -p "${BIOF3_ELECTRON_USER_DATA_DIR}"
export R_SERVER_PORT="${port}"
export BIOF3_ELECTRON_LOG_PATH="$(pwd)/.biof3-test-instance.log"

if [ "$(uname -s)" = "Darwin" ]; then
  export BIOF3_DB_PATH="$(pwd)/.biof3-dev-user-data/data/biof3.db"
  export BIOF3_LOCAL_DATA_DIR="$(pwd)/.biof3-dev-user-data/data"
  # 4) 分离启动（darwin）：nohup 直启 electron/cli.js；日志双通道与 Windows
  #    版同位（.biof3-test-instance.log / .err.log）。unset RUN_AS_NODE 防
  #    继承环境把 Electron 降级成纯 node。
  unset ELECTRON_RUN_AS_NODE
  nohup node node_modules/electron/cli.js . --dev --remote-debugging-port=9223 \
    > .biof3-test-instance.log 2> .biof3-test-instance.err.log &
  echo "start dispatched (darwin nohup pid $!)"
else
  export PATH="/c/Users/Admin/AppData/Roaming/fnm/node-versions/v24.20.0/installation:$PATH"
  export BIOF3_DB_PATH='D:\1.WorkDir\biof3-desktop\.biof3-dev-user-data\data\biof3.db'
  export BIOF3_LOCAL_DATA_DIR='D:\1.WorkDir\biof3-desktop\.biof3-dev-user-data\data'
  # 4) 分离启动（Start-Process 家法：hidden 会让页面 visibilityState=hidden；
  #    这里 minimized 只最小化 node 控制台，Electron 窗口由主进程离屏定位）
  powershell -NoProfile -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; Start-Process -FilePath 'C:\Users\Admin\AppData\Roaming\fnm\node-versions\v24.20.0\installation\node.exe' -ArgumentList 'node_modules\electron\cli.js','.','--dev','--remote-debugging-port=9223' -WorkingDirectory 'D:\1.WorkDir\biof3-desktop' -WindowStyle Minimized -RedirectStandardOutput 'D:\1.WorkDir\biof3-desktop\.biof3-test-instance.log' -RedirectStandardError 'D:\1.WorkDir\biof3-desktop\.biof3-test-instance.err.log'"
  echo "start dispatched"
fi

# 5) 就绪断言：9223 出现带 ?test=1 的页面目标（主进程已加载渲染层）
for i in $(seq 1 40); do
  sleep 3
  pages=$(curl -s -m 3 http://127.0.0.1:9223/json/list 2>/dev/null | grep -c 'test=1' || true)
  echo "t+$((i*3))s test=1 targets: ${pages}"
  if [ "${pages:-0}" -ge 1 ]; then
    echo "TEST INSTANCE READY (cdp 9223, userData .biof3-test-user-data)"
    exit 0
  fi
done
echo "TIMEOUT waiting for test instance on 9223 —— 日志见 .biof3-test-instance.err.log"
exit 1
