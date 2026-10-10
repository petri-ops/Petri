#!/usr/bin/env bash
# platform: posix（在中转服务器上运行，非本仓库开发机；BLOCK-159 家族 · 轻量批；BLOCK-165 对齐门禁取值集 darwin/posix/windows/dual）
# block159-relay-watchdog.sh — mobile 中转看门狗一键加固（软件独立性：与具体 IP/云厂商无关）。
#
# 目标（docs/guides/mobile-tunnel-aliyun-setup.md §⑥）：把中转机上的软件栈
# （nginx）从「手工态」变「看门狗态」，与桌面端 BLOCK-159 探活自愈形成双闭环：
#   1. nginx systemd 自愈（Restart=always）：进程挂掉 5s 内自动拉起；
#   2. 端到端探活计时器：每 GW_PROBE_SECS 秒经公网门 GET /api/mobile/status
#      期待 401（网关会话门活=整链通，与桌面端 probe 同判据）；非 401 →
#      journal 留痕 + 重启 nginx。桌面端隧道断由桌面侧自愈，服务器不代拨。
#
# 软件独立性红线：不写死任何 IP/域名/云厂商——网关卡端口、remotePort、探活
# 间隔全部环境变量可覆写（默认与指引一致）；任何装了 nginx+systemd 的
# Debian/Ubuntu 机器（aliyun/腾讯/AWS/裸 VPS）同样适用。
#
# 用法（在【中转服务器】上，root）：
#   bash block159-relay-watchdog.sh              # 安装/更新（幂等，可重复跑）
#   bash block159-relay-watchdog.sh --uninstall  # 撤销（移除单元与 drop-in）
# 环境变量：
#   GW_GATE_PORT=443        公网关卡（nginx listen）
#   GW_REMOTE_PORT=2233     桌面端隧道钉的远端回环端口（=tunnel.json remotePort）
#   GW_PROBE_SECS=120       探活间隔（秒）
#   GW_SSH_WATCHDOG=0       置 1 时连同 ssh 服务一起加 Restart=always（默认关：
#                           改 ssh 单元有锁死远程访问的风险，改前请确保有控制台兜底）

set -euo pipefail

GATE_PORT="${GW_GATE_PORT:-443}"
REMOTE_PORT="${GW_REMOTE_PORT:-2233}"
PROBE_SECS="${GW_PROBE_SECS:-120}"
SSH_WATCHDOG="${GW_SSH_WATCHDOG:-0}"
PROBE_BIN=/usr/local/sbin/petri-relay-probe.sh
PROBE_SERVICE=/etc/systemd/system/petri-relay-probe.service
PROBE_TIMER=/etc/systemd/system/petri-relay-probe.timer
NGINX_DROPIN_DIR=/etc/systemd/system/nginx.service.d

say() { echo "[relay-watchdog] $*"; }

if [ "${1:-}" = "--uninstall" ]; then
  say "撤销：停用并移除探活单元"
  systemctl disable --now petri-relay-probe.timer 2>/dev/null || true
  rm -f "$PROBE_TIMER" "$PROBE_SERVICE" "$PROBE_BIN"
  rm -rf "$NGINX_DROPIN_DIR"
  systemctl daemon-reload
  say "已撤销（nginx 回归发行版默认单元行为）"
  exit 0
fi

command -v systemctl >/dev/null || { say "需要 systemd（Debian/Ubuntu 均自带）"; exit 1; }
command -v nginx >/dev/null || { say "未找到 nginx——先按指引 §② 安装"; exit 1; }
command -v curl >/dev/null || { say "未找到 curl——apt install -y curl"; exit 1; }

# 1) nginx systemd 自愈（drop-in 不改发行版单元文件，卸载即净）
mkdir -p "$NGINX_DROPIN_DIR"
cat > "$NGINX_DROPIN_DIR/petri-watchdog.conf" <<'UNIT'
[Service]
Restart=always
RestartSec=5
UNIT

# 2) 可选：ssh 服务同款看门狗（默认关）
if [ "$SSH_WATCHDOG" = "1" ]; then
  SSH_UNIT=$(systemctl list-unit-files 'ssh*.service' --no-legend 2>/dev/null | awk '{print $1}' | grep -E '^ssh(d)?\.service$' | head -1 || true)
  if [ -n "${SSH_UNIT:-}" ]; then
    mkdir -p "/etc/systemd/system/${SSH_UNIT}.d"
    printf '[Service]\nRestart=on-failure\nRestartSec=5\n' > "/etc/systemd/system/${SSH_UNIT}.d/petri-watchdog.conf"
    say "ssh 看门狗已挂到 ${SSH_UNIT}（Restart=on-failure）"
  fi
fi

# 3) 端到端探活脚本：公网门 401=链路通（会话门活）；异常→journal+重启 nginx。
#    判据与桌面端 tunnel.js probe 完全同源（401 判活），双侧互不代拨：
#    桌面断→桌面自愈重拨；服务器 nginx 死→此处拉起。
cat > "$PROBE_BIN" <<UNIT
#!/usr/bin/env bash
# petri-relay-probe — 端到端探活（block159-relay-watchdog 安装；参数见文件头注释）
code=\$(curl -ksS -o /dev/null -w '%{http_code}' --max-time 8 \\
  "https://127.0.0.1:${GATE_PORT}/api/mobile/status" || echo 000)
if [ "\$code" = "401" ]; then
  exit 0
fi
logger -t petri-relay-probe "public gate unhealthy (http_code=\$code, expect 401) -> restarting nginx"
systemctl restart nginx
UNIT
chmod 700 "$PROBE_BIN"

# 4) systemd 单元 + 计时器（串行、不叠加；unref 等价=无 RemainAfterExit）
cat > "$PROBE_SERVICE" <<'UNIT'
[Unit]
Description=Petri mobile relay end-to-end probe (BLOCK-159 family)
After=network-online.target nginx.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/petri-relay-probe.sh
UNIT

cat > "$PROBE_TIMER" <<UNIT
[Unit]
Description=Petri mobile relay probe timer (every ${PROBE_SECS}s)

[Timer]
OnBootSec=60
OnUnitActiveSec=${PROBE_SECS}
Unit=petri-relay-probe.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now petri-relay-probe.timer

# 5) 当场取证一轮（不等首个计时）：结果如实打印，异常不吞
if "$PROBE_BIN"; then
  say "安装完成，当场探活：401 = 整链通（nginx 看门狗 + 每 ${PROBE_SECS}s 探活已就位）"
else
  say "安装完成，但当场探活未过（可能桌面端隧道未连）——nginx 看门狗与计时器已就位，journalctl -t petri-relay-probe 可查"
fi
systemctl --no-pager --lines=3 status petri-relay-probe.timer || true
