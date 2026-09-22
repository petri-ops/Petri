#!/usr/bin/env bash
# platform: windows（BLOCK-104 P4 双端同形门；当前实现含 taskkill/PowerShell 链——Mac 侧等价脚本待补，BLOCK-88 P4 教训在案）
# restart-dev-stack.sh — BLOCK-77 P4 phase2 编排：干净重启 dev 栈并等就绪。
# ⚠️ vite（:3000）是跨重启长活进程：本脚本只重启 electron/后端，不杀不拉 vite。
# 若 vite 被误杀，本脚本照常「就绪」但窗口黑屏（ERR_CONNECTION_REFUSED :3000）。
# 恢复：cd frontend && npm run dev（后台）→ 等 :3000 监听 → 主窗重新导航 :3000
#（chrome 错误页上 location.reload 无效，需显式 location.href='http://localhost:3000/'）。
# 2026-09-22 深夜实案（清僵尸进程误杀 vite 后黑屏）。
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
CDP_PORT="${BIOF3_DEV_CDP_PORT:-9222}"
occ9=$(netstat -ano | grep ":${CDP_PORT}" | grep LISTENING | awk '{print $5}' | head -1)
if [ -n "${occ9:-}" ]; then echo "kill stale cdp on ${CDP_PORT} (pid $occ9)"; taskkill_ms /PID "$occ9" /F; fi
sleep 2
# 6) 清场后置断言：杀没生效则重试等待（Windows 释放 socket 有秒级延迟——
#    2026-09-21 深夜实测：taskkill 成功后端口仍 LISTENING 数秒，2s 内断言即误报
#    「幽灵端口」；改为最多 30s 逐秒重试，超时仍占用才 ABORT）。
for p in 3001 "${CDP_PORT}"; do
  cleared=""
  for i in $(seq 1 30); do
    left=$(netstat -ano | grep ":$p" | grep LISTENING | head -1 || true)
    if [ -z "$left" ]; then cleared=1; break; fi
    sleep 1
  done
  if [ -z "$cleared" ]; then
    if [ "$p" = "${CDP_PORT}" ]; then
      # CDP 是辅助调试口（非用户面）：清不掉（会话级继承句柄幽灵）时自动换
      # 下一个空闲端口继续启动，不 ABORT——3001 才是硬性清场对象。
      CDP_PORT=$((p + 1))
      echo "WARN: CDP port $p 清不掉（继承句柄幽灵），改用 $CDP_PORT"
      export BIOF3_DEV_CDP_PORT="$CDP_PORT"
    else
      left=$(netstat -ano | grep ":$p" | grep LISTENING | head -1 || true)
      echo "ABORT: port $p still held after kill — 清场失败，拒绝继续（$left）"; exit 3
    fi
  fi
done

export PATH="/c/Users/Admin/AppData/Roaming/fnm/node-versions/v24.20.0/installation:$PATH"
export BIOF3_DB_PATH='D:\1.WorkDir\biof3-desktop\.biof3-dev-user-data\data\biof3.db'
export BIOF3_LOCAL_DATA_DIR='D:\1.WorkDir\biof3-desktop\.biof3-dev-user-data\data'
# BLOCK-85 双真机 — 跨端公网门自签证书 CA 信任（后端 fetch 8442/8443 必须；
# 证书=ECS /etc/nginx/ssl/gewu.crt 的本机拷贝。忘设=重启后跨端互访突然全断
# DEPTH_ZERO_SELF_SIGNED_CERT，见 dev-infra SKILL「端口与后端实例纪律」第 6 条）
# BLOCK-110-JEV — 决策 API 凭据注入（key 不入仓；文件在 gitignored 区，用户裁决
# 「key 暂保留后续轮换」，替换时只改 jev.env 并重启后端）。缺文件静默跳过。
# 部署密钥（.biof3-secrets，env 格式，gitignored——「不要 commit 到 git」）：
# 含 DASHSCOPE_API_KEY（知识嵌入）等。后端凭据链读 env，故启动前 source。
if [ -f "D:/1.WorkDir/biof3-desktop/.biof3-dev-user-data/.biof3-secrets" ]; then
  set -a
  . "D:/1.WorkDir/biof3-desktop/.biof3-dev-user-data/.biof3-secrets"
  set +a
  echo "deploy secrets: .biof3-secrets sourced (DASHSCOPE_API_KEY present)"
fi
if [ -f "D:/1.WorkDir/biof3-desktop/.biof3-dev-user-data/jev.env" ]; then
  set -a
  . "D:/1.WorkDir/biof3-desktop/.biof3-dev-user-data/jev.env"
  set +a
  echo "block110: jev.env loaded (TYPESAFE_API_KEY present)"
fi
if [ -f "D:/1.WorkDir/biof3-desktop/.biof3-dev-user-data/ecs-gewu.crt" ]; then
  export NODE_EXTRA_CA_CERTS='D:\1.WorkDir\biof3-desktop\.biof3-dev-user-data\ecs-gewu.crt'
  echo "block85: NODE_EXTRA_CA_CERTS set (ecs-gewu.crt)"
fi
# BLOCK-95 三开关 2026-09-18 已翻默认开（feature-flags.js 单一真相 + 设置页 UI-403）。
# 此处只透传调用方覆盖：=1/=0 强制开/关（kill-switch）；留空=走默认（现在默认开）。
export BIOF3_SERVER_HISTORY_ASSEMBLY="${BIOF3_SERVER_HISTORY_ASSEMBLY:-}"
export BIOF3_SESSION_COMPACTION="${BIOF3_SESSION_COMPACTION:-}"
if [ -n "${BIOF3_SERVER_HISTORY_ASSEMBLY}" ]; then echo "block95: env override BIOF3_SERVER_HISTORY_ASSEMBLY=${BIOF3_SERVER_HISTORY_ASSEMBLY}"; fi
if [ -n "${BIOF3_SESSION_COMPACTION}" ]; then echo "block95: env override BIOF3_SESSION_COMPACTION=${BIOF3_SESSION_COMPACTION}"; fi


# -WindowStyle Minimized（最小化的是 node 控制台；Electron GUI 正常显示）。
# 禁止 Hidden：hidden 启动会让页面 visibilityState=hidden，Chromium 冻结视口
# （实测 949px）并触发懒渲染跳过——左栏 projectTree 不渲染，验收断言全歪。
# 4) 必须剥离 ELECTRON_RUN_AS_NODE —— 该变量一旦进环境，electron 二进制退化成纯 node，
#    require('electron') 返路径串、app 变 undefined → main.js:148 requestSingleInstanceLock 崩。
#    Start-Process 从当前 shell 继承环境，故此处显式清掉（PowerShell -Environment 不可用，改用 Remove-Item Env:）。
if [ -n "${ELECTRON_RUN_AS_NODE:-}" ]; then unset ELECTRON_RUN_AS_NODE; echo "stripped leaked ELECTRON_RUN_AS_NODE from env"; fi
powershell -NoProfile -Command "Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue; Start-Process -FilePath 'C:\Users\Admin\AppData\Roaming\fnm\node-versions\v24.20.0\installation\node.exe' -ArgumentList 'node_modules\electron\cli.js','.','--dev','--remote-debugging-port=${CDP_PORT}' -WorkingDirectory 'D:\1.WorkDir\biof3-desktop' -WindowStyle Minimized -RedirectStandardOutput 'D:\1.WorkDir\biof3-desktop\.dev-stack-live.log' -RedirectStandardError 'D:\1.WorkDir\biof3-desktop\.dev-stack-err.log'"
echo "start dispatched"

for i in $(seq 1 36); do
  sleep 5
  pages=$(curl -s -m 10 http://127.0.0.1:${CDP_PORT}/json/list 2>/dev/null | grep -c '"type": "page"' || true)
  # 7) 就绪判定不许带 `-o /dev/null`（2026-09-14 实测沉淀）：本机 Git Bash 下
  #    `curl -o /dev/null` exit=23（写 NUL 失败）→ 配合 `|| echo 000` 会把结果拼成
  #    `200000`，于是 `= "200"` 永不成立 → 明明就绪也必然 TIMEOUT。改为读末行 http_code。
  code=$(curl -s -m 10 -H 'Authorization: Bearer desktop-local' 'http://127.0.0.1:3001/api/data/projects' -w '\n%{http_code}' 2>/dev/null | tail -n1)
  echo "t+$((i*5))s pages=${pages} api=${code}"
  if [ "${pages:-0}" -ge 1 ] 2>/dev/null && [ "${code}" = "200" ]; then
    # 数据面对账：连到的库必须非空（防再次连错库）
    n=$(curl -s -m 10 -H 'Authorization: Bearer desktop-local' 'http://127.0.0.1:3001/api/data/projects' | grep -o '"id"' | wc -l)
    echo "projects in api response: ${n}"
    if [ "${n:-0}" -ge 1 ] 2>/dev/null; then echo READY; exit 0; fi
    echo "WARN: api up but projects empty — wrong DB?"; exit 1
  fi
done
echo TIMEOUT
exit 1
