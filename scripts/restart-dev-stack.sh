#!/usr/bin/env bash
# restart-dev-stack.sh — BLOCK-77 P4 phase2 编排：干净重启 dev 栈并等就绪。
# 2026-09-11 沉淀（当次踩坑三连）：
#   1) detached backend 会逃逸 electron 树杀 → 必须 kill 3001 监听者（僵尸）；
#   2) dev 栈数据面在 BIOF3_DB_PATH / BIOF3_LOCAL_DATA_DIR（.biof3-dev-user-data/data），
#      不带 env 重启会连到默认空库（BLOCK-79 环境事实的环境变量版）；
#   3) cmd.exe .cmd 必须 CRLF（LF 会炸），改用 PowerShell Start-Process 直启 node。
set -u
cd "$(dirname "$0")/.." || exit 2

# 5) taskkill 参数必须走 MSYS_NO_PATHCONV=1 + 单斜杠（2026-09-14 实测沉淀）：
#    Git Bash 下 `taskkill //IM x //F` 会把 `//IM` 原样传给原生程序 → 
#    「错误: 无效参数/选项 - '//IM'」→ **杀进程整段静默空操作**（旧 Electron 实例
#    仍持单实例锁 → 新实例起来即退 → 本脚本看起来"重启成功"其实什么都没发生，
#    最后必然 TIMEOUT）。加 MSYS_NO_PATHCONV=1 后 `/IM` /`/F` 原样透传，行为正确。
taskkill_ms() { MSYS_NO_PATHCONV=1 taskkill "$@" >/dev/null 2>&1 || true; }
taskkill_ms /IM electron.exe /F
occ=$(netstat -ano | grep ':3001' | grep LISTENING | awk '{print $5}' | head -1)
if [ -n "${occ:-}" ]; then echo "kill stale backend on 3001 (pid $occ)"; taskkill_ms /PID "$occ" /F; fi
occ9=$(netstat -ano | grep ':9222' | grep LISTENING | awk '{print $5}' | head -1)
if [ -n "${occ9:-}" ]; then echo "kill stale cdp on 9222 (pid $occ9)"; taskkill_ms /PID "$occ9" /F; fi
sleep 2
# 6) 清场后置断言：杀没生效则立刻报错，不允许再次"静默不重启"。
for p in 3001 9222; do
  left=$(netstat -ano | grep ":$p" | grep LISTENING | head -1 || true)
  if [ -n "$left" ]; then echo "ABORT: port $p still held after kill — 清场失败，拒绝继续（$left）"; exit 3; fi
done

export PATH="/c/Users/Admin/AppData/Roaming/fnm/node-versions/v24.20.0/installation:$PATH"
export BIOF3_DB_PATH='D:\1.WorkDir\biof3-desktop\.biof3-dev-user-data\data\biof3.db'
export BIOF3_LOCAL_DATA_DIR='D:\1.WorkDir\biof3-desktop\.biof3-dev-user-data\data'
# BLOCK-95 B1 灰度开关：默认空=关；调用方 BIOF3_SERVER_HISTORY_ASSEMBLY=1 bash scripts/restart-dev-stack.sh 开启
export BIOF3_SERVER_HISTORY_ASSEMBLY="${BIOF3_SERVER_HISTORY_ASSEMBLY:-}"
if [ -n "${BIOF3_SERVER_HISTORY_ASSEMBLY}" ]; then echo "block95-b1: server history assembly ON (grayscale)"; fi


# -WindowStyle Minimized（最小化的是 node 控制台；Electron GUI 正常显示）。
# 禁止 Hidden：hidden 启动会让页面 visibilityState=hidden，Chromium 冻结视口
# （实测 949px）并触发懒渲染跳过——左栏 projectTree 不渲染，验收断言全歪。
# 4) 必须剥离 ELECTRON_RUN_AS_NODE —— 该变量一旦进环境，electron 二进制退化成纯 node，
#    require('electron') 返路径串、app 变 undefined → main.js:148 requestSingleInstanceLock 崩。
#    Start-Process 从当前 shell 继承环境，故此处显式清掉（PowerShell -Environment 不可用，改用 Remove-Item Env:）。
if [ -n "${ELECTRON_RUN_AS_NODE:-}" ]; then unset ELECTRON_RUN_AS_NODE; echo "stripped leaked ELECTRON_RUN_AS_NODE from env"; fi
powershell -NoProfile -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; Start-Process -FilePath 'C:\Users\Admin\AppData\Roaming\fnm\node-versions\v24.20.0\installation\node.exe' -ArgumentList 'node_modules\electron\cli.js','.','--dev','--remote-debugging-port=9222' -WorkingDirectory 'D:\1.WorkDir\biof3-desktop' -WindowStyle Minimized -RedirectStandardOutput 'D:\1.WorkDir\biof3-desktop\.dev-stack-live.log' -RedirectStandardError 'D:\1.WorkDir\biof3-desktop\.dev-stack-err.log'"
echo "start dispatched"

for i in $(seq 1 36); do
  sleep 5
  pages=$(curl -s http://127.0.0.1:9222/json/list 2>/dev/null | grep -c '"type": "page"' || true)
  # 7) 就绪判定不许带 `-o /dev/null`（2026-09-14 实测沉淀）：本机 Git Bash 下
  #    `curl -o /dev/null` exit=23（写 NUL 失败）→ 配合 `|| echo 000` 会把结果拼成
  #    `200000`，于是 `= "200"` 永不成立 → 明明就绪也必然 TIMEOUT。改为读末行 http_code。
  code=$(curl -s -H 'Authorization: Bearer desktop-local' 'http://127.0.0.1:3001/api/data/projects' -w '\n%{http_code}' 2>/dev/null | tail -n1)
  echo "t+$((i*5))s pages=${pages} api=${code}"
  if [ "${pages:-0}" -ge 1 ] 2>/dev/null && [ "${code}" = "200" ]; then
    # 数据面对账：连到的库必须非空（防再次连错库）
    n=$(curl -s -H 'Authorization: Bearer desktop-local' 'http://127.0.0.1:3001/api/data/projects' | grep -o '"id"' | wc -l)
    echo "projects in api response: ${n}"
    if [ "${n:-0}" -ge 1 ] 2>/dev/null; then echo READY; exit 0; fi
    echo "WARN: api up but projects empty — wrong DB?"; exit 1
  fi
done
echo TIMEOUT
exit 1
