#!/usr/bin/env bash
# mac-85-prepare.sh — BLOCK-85 双真机验收 Mac 侧一键准备（起栈 + 隧道自愈 + REST 出码）
# 用法：bash scripts/mac-85-prepare.sh
# 幂等：网关/隧道已在则跳过对应步骤；出码每次刷新（TTL 5 分钟）。
# 出码纪律：REST 从 :3001 签发（SKILL 第 1 条脑裂纪律），禁用面板 UI 出码。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

say(){ echo "[mac-85] $*"; }
say "repo: $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)"

# --- 1) 网关（:3005 会话门 401=活）---
GW=$(curl -s --max-time 3 http://127.0.0.1:3005/api/mobile/status 2>/dev/null || true)
if echo "$GW" | grep -q session_invalid; then
  say "网关已在线（:3005 → 401 session_invalid），跳过起栈"
else
  say "网关不在，BIOF3_MOBILE_ENABLED=1 起栈（后台 nohup，日志 /tmp/gewu-dev-85.log）..."
  BIOF3_MOBILE_ENABLED=1 nohup npm run dev > /tmp/gewu-dev-85.log 2>&1 &
  say "等待网关上线（最长 90s，Electron 窗口会弹出）..."
  for i in $(seq 1 45); do
    sleep 2
    GW=$(curl -s --max-time 3 http://127.0.0.1:3005/api/mobile/status 2>/dev/null || true)
    echo "$GW" | grep -q session_invalid && break
  done
  if ! echo "$GW" | grep -q session_invalid; then
    say "ERROR: 网关 90s 未上线，查日志：tail -40 /tmp/gewu-dev-85.log"; exit 1
  fi
  say "网关已上线"
fi

# --- 2) 隧道（公网门 8443 → 401 = Mac ssh -R 2234 + nginx 全通）---
pub_ok(){
  curl -sk --max-time 8 https://47.110.228.168:8443/api/mobile/status 2>/dev/null | grep -q session_invalid
}
if pub_ok; then
  say "公网门 8443 已通（401），隧道 OK"
else
  if pgrep -f "R 127.0.0.1:2234" >/dev/null 2>&1; then
    say "本机已有 2234 隧道进程但公网门不通——查 /tmp/fed-tunnel-2234.log 或 sshd 日志（不重复起，避免双循环互抢）"; exit 1
  fi
  say "隧道不在，起自愈守护（与 Windows fed-tunnel 同款 while 循环）..."
  cat > /tmp/fed-tunnel-2234.sh <<'TUNEOF'
#!/bin/bash
while true; do
  ssh -N -T -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ConnectTimeout=10 -R 127.0.0.1:2234:127.0.0.1:3005 aliyun
  sleep 3
done
TUNEOF
  chmod +x /tmp/fed-tunnel-2234.sh
  nohup /tmp/fed-tunnel-2234.sh > /tmp/fed-tunnel-2234.log 2>&1 &
  say "等待隧道建立（最长 30s）..."
  for i in $(seq 1 15); do
    sleep 2
    pub_ok && break
  done
  if ! pub_ok; then
    say "ERROR: 公网门仍不通——查 tail -20 /tmp/fed-tunnel-2234.log（aliyun sshd/密钥/2234 冲突）"; exit 1
  fi
  say "隧道已建立并自愈在守"
fi

# --- 3) REST 出码 + 公网链接 ---
RESP=$(curl -s --max-time 5 -X POST http://127.0.0.1:3001/api/mobile/pairing/token \
  -H "Authorization: Bearer desktop-local" -d "{}")
say "出码响应: $RESP"
TOKEN=$(echo "$RESP" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
[ -n "$TOKEN" ] || TOKEN=$(echo "$RESP" | sed -n 's/.*"pairingToken":"\([^"]*\)".*/\1/p')
if [ -z "$TOKEN" ]; then
  say "ERROR: 未解析到 token（字段名不同？）——用上方响应原文手动拼链接"; exit 1
fi
URL="https://47.110.228.168:8443/pair?token=${TOKEN}"
echo "$URL" | pbcopy 2>/dev/null && say "（链接已进剪贴板）"
echo ""
echo "=========================================================="
echo "  把这行发到 Windows 会话（TTL 5 分钟，立即发）："
echo "  $URL"
echo "=========================================================="

# --- 4) P2/P3 前置顺带核对 ---
if command -v Rscript >/dev/null 2>&1; then
  say "R 运行时: $(Rscript --version 2>&1 | head -1)（P2 分析作业 OK）"
else
  say "WARN: 未找到 Rscript——P2 真实分析作业需要 Mac 有 R 运行时"
fi
say "P3 前置自查：chat 模型凭据（DeepSeek）在 设置→AI 内确认"
