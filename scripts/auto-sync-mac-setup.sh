#!/usr/bin/env bash
# auto-sync-mac-setup.sh — Mac 侧一键部署远程库自动同步（安全档，与 Windows Gewu-AutoSync 对称）
# 用法（Mac 侧 pull 后仓库内执行）：
#   bash scripts/auto-sync-mac-setup.sh              # 部署 + 启动 + 验证
#   bash scripts/auto-sync-mac-setup.sh --dry-run    # 只打印将写入的 plist，不落盘不加载
#   bash scripts/auto-sync-mac-setup.sh --uninstall  # 卸载 launchd agent
# 产物：~/Library/LaunchAgents/com.gewu.auto-sync.plist → 每 120 秒跑仓库内 scripts/auto-sync-remote.sh
# 行为边界与 Windows 完全同形：仅 fetch + ff-only 快进；分叉只登记 events；推不自动（SKILL 第 8 条）。
set -euo pipefail
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.gewu.auto-sync"
PLIST="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="$REPO_DIR/.biof3-dev-user-data"
INTERVAL=120

case "${1:-}" in
  --uninstall)
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "[auto-sync-mac] uninstalled: $PLIST"
    exit 0
    ;;
esac

mkdir -p "$LOG_DIR"

PLIST_CONTENT=$(cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${REPO_DIR}/scripts/auto-sync-remote.sh</string>
  </array>
  <key>StartInterval</key>
  <integer>${INTERVAL}</integer>
  <key>RunAtLoad</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_DIR}/auto-sync-launchd.out</string>
  <key>StandardErrorPath</key>
  <string>${LOG_DIR}/auto-sync-launchd.err</string>
</dict>
</plist>
EOF
)

if [ "${1:-}" = "--dry-run" ]; then
  echo "$PLIST_CONTENT"
  exit 0
fi

printf '%s\n' "$PLIST_CONTENT" > "$PLIST"
xmllint --noout "$PLIST" && echo "[auto-sync-mac] plist xml valid: $PLIST"

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"
# 立即触发一轮做端到端验证（RunAtLoad 已跑一次，这里再 kick 一次对齐验证窗口）
launchctl start "$LABEL" || true
sleep 2

echo "[auto-sync-mac] launchctl 状态（第一列=PID 或 -，第二列=上次退出码，0=健康）:"
launchctl list | grep "$LABEL" || { echo "[auto-sync-mac] ERROR: agent 未加载"; exit 1; }
echo "[auto-sync-mac] 部署完成。流水日志: $LOG_DIR/auto-sync.log；待裁决事件: $LOG_DIR/auto-sync-events.log"
echo "[auto-sync-mac] 按双端协同协议⑤，请向 Windows 侧回报本输出 + git log --oneline -1"
