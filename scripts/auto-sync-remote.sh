#!/usr/bin/env bash
# platform: posix（BLOCK-104 P4 双端同形门）
# auto-sync-remote.sh — 远程库自动同步（安全档：仅 fetch + ff-only 快进）
# 用户裁决 2026-09-18「计划任务 + 安全档」：分叉/失败只登记 events 待裁决，
# 绝不自动 rebase / push / stash / 解冲突。
# 双端同形：Windows=计划任务 Gewu-AutoSync（scripts/auto-sync-remote.cmd 包装，每 2 分钟）；
# Mac=launchd com.gewu.auto-sync（scripts/auto-sync-mac-setup.sh 一键部署，每 120 秒）。
# 兼容性注记：date 用 %Y-%m-%d %H:%M:%S 而非 %F %T（BSD/GNU 双兼容），无 bash4+ 特性（macOS 自带 bash 3.2 可跑）。
set -u
cd "$(dirname "$0")/.." || exit 1

DATA_DIR=".biof3-dev-user-data"
LOG="$DATA_DIR/auto-sync.log"            # 全量流水：只在有动作的轮次写
EVENTS="$DATA_DIR/auto-sync-events.log"  # 待裁决事件：agent 会话启动对账入口（SKILL 第 8 条）
LOCK="$DATA_DIR/.auto-sync.lock"

[ -d "$DATA_DIR" ] || mkdir -p "$DATA_DIR"
log()   { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }
event() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$EVENTS"; }

# --- 互斥锁（mkdir 原子；残留 >10 分钟视为陈锁清除）---
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ]; then
    rmdir "$LOCK" 2>/dev/null || rm -rf "$LOCK"
    mkdir "$LOCK" 2>/dev/null || exit 0
  else
    exit 0  # 上一轮还在跑，直接让路
  fi
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# --- 1) fetch（失败静默等下轮：网络抖动是常态，不算事件）---
git fetch origin >/dev/null 2>&1 || { log "FETCH_FAIL (retry next tick)"; exit 0; }

LOCAL=$(git rev-parse HEAD 2>/dev/null) || exit 0
REMOTE=$(git rev-parse origin/main 2>/dev/null) || exit 0
[ "$LOCAL" = "$REMOTE" ] && exit 0  # 已同步，零动作退出

# --- 2) 判据：工作区干净（WIP 时连 ff 都可能被拒，且不动用户的 stash）---
if [ -n "$(git status --porcelain)" ]; then
  log "SKIP dirty worktree (behind=$(git rev-list --count HEAD..origin/main)) — wait for clean"
  exit 0
fi

# --- 3) 判据：无进行中的 git 操作 ---
for f in .git/rebase-merge .git/rebase-apply .git/MERGE_HEAD .git/CHERRY_PICK_HEAD; do
  if [ -e "$f" ]; then log "SKIP git-op-in-progress ($f)"; exit 0; fi
done

# --- 4) 分派 ---
if git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
  # 纯落后 → ff-only 快进（fast-forward 定义上不可能冲突）
  if git merge --ff-only origin/main >>"$LOG" 2>&1; then
    log "FF $(git rev-parse --short "$LOCAL") -> $(git rev-parse --short HEAD) (+$(git rev-list --count "$LOCAL..HEAD")) — dev 栈在跑则 Vite 热更会闪窗口（预期）"
  else
    log "FF_FAIL local=$(git rev-parse --short "$LOCAL") remote=$(git rev-parse --short "$REMOTE")"
    event "FF_FAIL local=$(git rev-parse --short "$LOCAL") remote=$(git rev-parse --short "$REMOTE") — 查 auto-sync.log 的 merge 输出"
  fi
  exit 0
fi

if git merge-base --is-ancestor origin/main HEAD 2>/dev/null; then
  exit 0  # 纯领先：本地有未推送的活，静默（推送由会话收口控制，不自动推）
fi

# 双方分叉 → 安全档不自动 rebase，登记待裁决（同 remote 去重，防每 2 分钟刷屏）
AHEAD=$(git rev-list --count origin/main..HEAD)
BEHIND=$(git rev-list --count HEAD..origin/main)
if ! tail -3 "$EVENTS" 2>/dev/null | grep -q "remote=$(git rev-parse --short "$REMOTE") "; then
  log "DIVERGED ahead=$AHEAD behind=$BEHIND — registered in events, awaiting verdict"
  event "DIVERGED local=$(git rev-parse --short HEAD) remote=$(git rev-parse --short "$REMOTE") ahead=$AHEAD behind=$BEHIND — 需裁决 rebase（安全档不自动改历史）"
fi
exit 0
