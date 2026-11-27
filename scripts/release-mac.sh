#!/usr/bin/env bash
# scripts/release-mac.sh — item 91：release-mac 本地一键打包（备用能力）。
#
# 流程：build:mac 全流程（item66 已修 ABI 探针，无需豁免）→ dmg（arm64+x64）归集到
# dist-release/<版本号-时间戳>/ → 打印产物绝对路径/大小/版本号。
#
# 语义：set -euo pipefail（失败即停）；失败时保留完整日志并打印日志路径。
# 安全垫：真实打包前 dist-release 目录不影响 git（.gitignore 已含 dist-release/）。
#
# 用法：
#   npm run release:mac              # 真实打包（十几分钟量级，owner 实跑验证）
#   npm run release:mac -- --dry-run # 自测：跳过构建，验证目录结构/版本号提取
#
# 测试可注入：RELEASE_BUILD_CMD（默认 `npm run build:mac`）——HK-01 用 `false` 模拟构建失败。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

VERSION="$(node -p "require('./package.json').version")"
TS="$(date +%Y%m%d-%H%M)"
DEST="$ROOT/dist-release/${VERSION}-${TS}"
LOG="$DEST/build.log"
BUILD_CMD="${RELEASE_BUILD_CMD:-npm run build:mac}"

mkdir -p "$DEST"

log() { echo "[release-mac] $*" | tee -a "$LOG"; }

if $DRY_RUN; then
  log "dry-run：跳过构建，仅自测目录结构/版本号提取"
  log "将执行：${BUILD_CMD}（已跳过）"
  log "产物归集目标：$DEST"
  log "预期产物：dist/Petri-${VERSION}-arm64.dmg、dist/Petri-${VERSION}-x64.dmg → 归集到上述目录"
  log "版本号：${VERSION}"
  exit 0
fi

log "版本：${VERSION}  时间戳：${TS}"
log "开始 build:mac 全流程（完整日志：${LOG}）…"
if ! $BUILD_CMD >>"$LOG" 2>&1; then
  log "FAIL：构建失败（exit 非零）——完整日志：${LOG}"
  echo "----- 日志尾部 40 行 -----" >&2
  tail -40 "$LOG" >&2 || true
  exit 1
fi
log "构建完成，归集 dmg（arm64+x64）…"

shopt -s nullglob
DMGS=(dist/*.dmg)
if [ "${#DMGS[@]}" -eq 0 ]; then
  log "FAIL：dist/ 未找到 dmg 产物——完整日志：${LOG}"
  exit 1
fi

for f in "${DMGS[@]}"; do
  base="$(basename "$f")"
  cp "$f" "$DEST/"
  size="$(du -h "$DEST/$base" | cut -f1)"
  abs="$(cd "$DEST" && pwd)/$base"
  log "归集：$f → ${abs}（${size}）"
done

log "版本号：${VERSION}"
log "产物目录：$(cd "$DEST" && pwd)"
log "DONE：$(ls -1 "$DEST"/*.dmg | wc -l | tr -d ' ') 个 dmg 已归集"
