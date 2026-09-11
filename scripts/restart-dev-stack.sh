#!/usr/bin/env bash
# restart-dev-stack.sh — BLOCK-77 P4 phase2 编排：干净重启 dev 栈并等就绪。
# 2026-09-11 沉淀（当次踩坑三连）：
#   1) detached backend 会逃逸 electron 树杀 → 必须 kill 3001 监听者（僵尸）；
#   2) dev 栈数据面在 BIOF3_DB_PATH / BIOF3_LOCAL_DATA_DIR（.biof3-dev-user-data/data），
#      不带 env 重启会连到默认空库（BLOCK-79 环境事实的环境变量版）；
#   3) cmd.exe .cmd 必须 CRLF（LF 会炸），改用 PowerShell Start-Process 直启 node。
set -u
cd "$(dirname "$0")/.." || exit 2

taskkill //IM electron.exe //F >/dev/null 2>&1
occ=$(netstat -ano | grep ':3001' | grep LISTENING | awk '{print $5}' | head -1)
if [ -n "${occ:-}" ]; then echo "kill stale backend on 3001 (pid $occ)"; taskkill //PID "$occ" //F >/dev/null 2>&1; fi
occ9=$(netstat -ano | grep ':9222' | grep LISTENING | awk '{print $5}' | head -1)
if [ -n "${occ9:-}" ]; then echo "kill stale cdp on 9222 (pid $occ9)"; taskkill //PID "$occ9" //F >/dev/null 2>&1; fi
sleep 2

export PATH="/c/Users/Admin/AppData/Roaming/fnm/node-versions/v24.20.0/installation:$PATH"
export BIOF3_DB_PATH='D:\1.WorkDir\biof3-desktop\.biof3-dev-user-data\data\biof3.db'
export BIOF3_LOCAL_DATA_DIR='D:\1.WorkDir\biof3-desktop\.biof3-dev-user-data\data'

powershell -NoProfile -Command "Start-Process -FilePath 'C:\Users\Admin\AppData\Roaming\fnm\node-versions\v24.20.0\installation\node.exe' -ArgumentList 'node_modules\electron\cli.js','.','--dev','--remote-debugging-port=9222' -WorkingDirectory 'D:\1.WorkDir\biof3-desktop' -WindowStyle Hidden -RedirectStandardOutput 'D:\1.WorkDir\biof3-desktop\.dev-stack-live.log' -RedirectStandardError 'D:\1.WorkDir\biof3-desktop\.dev-stack-err.log'"
echo "start dispatched"

for i in $(seq 1 36); do
  sleep 5
  pages=$(curl -s http://127.0.0.1:9222/json/list 2>/dev/null | grep -c '"type": "page"' || true)
  code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer desktop-local' 'http://127.0.0.1:3001/api/data/projects' 2>/dev/null || echo 000)
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
