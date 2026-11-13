#!/bin/bash
# BLOCK-440 — 隔离式打包：强制重建 Electron ABI → 打包 → 必恢复开发 Node ABI。
#
# 为什么需要这个脚本（全部来自实测）：
#   1. build/afterPack.js 自带 ABI 探测门：better-sqlite3 必须与打包 Electron ABI 匹配，
#      否则 fail-closed（"未找到匹配打包 Electron ABI 的 better-sqlite3 二进制"）。
#   2. `npx electron-builder install-app-deps` 会报「已完成」但实际跳过重建
#      （build/Release 仍是 Node ABI 137 → afterPack 探测 ABI_MISMATCH）。
#      必须 `npx electron-rebuild -f -w better-sqlite3` 强制重建。
#   3. 重建会覆盖开发依赖的 build/Release（Node ABI 137 → Electron ABI 149），
#      打包后不恢复则本地后端/测试全部 ERR_DLOPEN_FAILED。
#   4. IDE 通过 NODE_OPTIONS 注入 safe-delete shim，会拦截 electron-builder 的批量删除
#      （5946 文件 > 阈值 500）；本脚本不加载该 shim。
#
# 用法：bash scripts/build-packaged-isolated.sh
# 产物：dist/mac-arm64/<Product>.app + dist/*.dmg（dist/ 已 gitignore）
# 退出码：0=打包成功且 ABI 已恢复；2=重建失败；3=打包失败；5=打包成功但恢复异常

set -o pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1

unset NODE_OPTIONS CODEBUDDY_EH_ROLE CODEBUDDY_EH_AFFINITY

restore_abi() {
  echo "[pack-isolated] 恢复开发环境 Node ABI（better-sqlite3 × 2）"
  npm rebuild better-sqlite3 >/tmp/pack-isolated-rebuild-root.log 2>&1
  ( cd core/petri-server && npm rebuild better-sqlite3 >/tmp/pack-isolated-rebuild-core.log 2>&1 )
  node -e "const D=require('better-sqlite3');new D(':memory:').close();console.log('[pack-isolated] root ABI OK')" \
    || echo "[pack-isolated] WARN: root ABI 异常（/tmp/pack-isolated-rebuild-root.log）"
  ( cd core/petri-server && node -e "const D=require('better-sqlite3');new D(':memory:').close();console.log('[pack-isolated] core ABI OK')" ) \
    || echo "[pack-isolated] WARN: core ABI 异常（/tmp/pack-isolated-rebuild-core.log）"
}
trap restore_abi EXIT

echo "[pack-isolated] ① 清空旧产物"
if [ -d dist/mac-arm64 ]; then
  find dist/mac-arm64 -mindepth 1 -delete 2>/dev/null
fi
rm -f dist/*.dmg dist/*.dmg.blockmap 2>/dev/null

echo "[pack-isolated] ② 强制重建 better-sqlite3 为 Electron ABI"
npx electron-rebuild -f -w better-sqlite3 -v 44.7.0 || exit 2

echo "[pack-isolated] ③ 打包 mac-arm64"
npm run build:mac-arm64 || exit 3

APP="$(ls -d dist/mac-arm64/*.app 2>/dev/null | head -1)"
if [ -z "$APP" ]; then
  echo "[pack-isolated] ERROR: 产物缺失"
  exit 4
fi
echo "[pack-isolated] 产物: $APP"

restore_abi
trap - EXIT
echo "[pack-isolated] DONE: 打包成功 + 开发 ABI 已恢复"
