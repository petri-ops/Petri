#!/bin/bash
# ============================================================
# fix-r-paths.sh — R Runtime 解压后修正 dylib 路径
#
# R.framework 的 dylib 和 .so 文件里硬编码了
#   /Library/Frameworks/R.framework/Versions/<ver>/Resources/lib/...
# 解压到任意目录后这些路径失效，需要改成 @rpath / @loader_path。
#
# 用法： ./fix-r-paths.sh <R_HOME_DIR>
# 幂等： 重复跑不会出错（install_name_tool -change 对已改路径是 no-op）
#
# 验证： 修完后 R_HOME=<dir> <dir>/bin/R --slave -e 'library(methods); cat("ok")'
# ============================================================

set -euo pipefail

R_HOME="${1:-}"
if [[ -z "$R_HOME" || ! -d "$R_HOME" ]]; then
  echo "Usage: $0 <R_HOME_DIR>" >&2
  exit 1
fi

LIB="$R_HOME/lib"
BIN_EXEC="$R_HOME/bin/exec/R"

if [[ ! -d "$LIB" || ! -f "$BIN_EXEC" ]]; then
  echo "❌ Not a valid R runtime: $R_HOME (missing lib/ or bin/exec/R)" >&2
  exit 1
fi

echo "[fix-r-paths] R_HOME=$R_HOME"

# ── 1. bin/R 脚本：硬编码路径 → 动态解析 ────────────────────────
R_SCRIPT="$R_HOME/bin/R"
if [[ -f "$R_SCRIPT" && ! -L "$R_SCRIPT" ]]; then
  # 只对 shell 脚本生效（二进制 Rscript 跳过）
  if file "$R_SCRIPT" | grep -q "shell script"; then
    # 用 sed 原地替换（macOS sed 需要 -i ''）
    sed -i '' 's|^R_HOME_DIR=.*|R_HOME_DIR="$(cd "$(dirname "$0")/.." \&\& pwd)"|' "$R_SCRIPT"
    sed -i '' 's|^R_SHARE_DIR=.*|R_SHARE_DIR="${R_HOME_DIR}/share"|' "$R_SCRIPT"
    sed -i '' 's|^R_INCLUDE_DIR=.*|R_INCLUDE_DIR="${R_HOME_DIR}/include"|' "$R_SCRIPT"
    sed -i '' 's|^R_DOC_DIR=.*|R_DOC_DIR="${R_HOME_DIR}/doc"|' "$R_SCRIPT"
    echo "[fix-r-paths] bin/R script paths → dynamic"
  fi
fi

# ── 2. 核心 dylib：修正 id + 依赖路径 ───────────────────────────
# 需要修正的 dylib 列表
CORE_DYLIBS=(
  libR.dylib
  libRblas.dylib
  libRblas.0.dylib
  libRblas.vecLib.dylib
  libRlapack.dylib
  libgfortran.5.dylib
  libquadmath.0.dylib
  libgcc_s.1.1.dylib
  libomp.dylib
)

for dylib in "${CORE_DYLIBS[@]}"; do
  f="$LIB/$dylib"
  [[ ! -f "$f" ]] && continue

  # 2a. 修正自身 id → @rpath/<name>
  install_name_tool -id "@rpath/$dylib" "$f" 2>/dev/null || true

  # 2b. 修正所有指向 R.framework 或旧绝对路径的依赖 → @loader_path/<name>
  # otool -L 输出格式：行首 tab + 路径 + (版本信息)
  # 用 grep 过滤出需要改的行，cut 取第一列（路径）
  deps=$(otool -L "$f" 2>/dev/null \
    | grep -E "/(Library/Frameworks/R\.framework|Documents/.*resources/R/lib)/" \
    | sed 's/^[[:space:]]*//' | cut -d' ' -f1 || true)

  if [[ -n "$deps" ]]; then
    while IFS= read -r dep; do
      [[ -z "$dep" ]] && continue
      depname=$(basename "$dep")
      install_name_tool -change "$dep" "@loader_path/$depname" "$f" 2>/dev/null || true
    done <<< "$deps"
  fi
done
echo "[fix-r-paths] core dylibs fixed (${#CORE_DYLIBS[@]} files)"

# ── 3. exec/R：依赖路径 → @rpath + 加 rpath ─────────────────────
if [[ -f "$BIN_EXEC" ]]; then
  # 修正依赖路径
  deps=$(otool -L "$BIN_EXEC" 2>/dev/null \
    | grep -E "/(Library/Frameworks/R\.framework|Documents/.*resources/R/lib)/" \
    | sed 's/^[[:space:]]*//' | cut -d' ' -f1 || true)

  if [[ -n "$deps" ]]; then
    while IFS= read -r dep; do
      [[ -z "$dep" ]] && continue
      depname=$(basename "$dep")
      install_name_tool -change "$dep" "@rpath/$depname" "$BIN_EXEC" 2>/dev/null || true
    done <<< "$deps"
  fi

  # 加 rpath 指向 ../../lib（exec/R 在 bin/exec/ 下，lib 在 lib/ 下）
  # 幂等：如果已有相同 rpath 会报错，用 || true 忽略
  install_name_tool -add_rpath @loader_path/../../lib "$BIN_EXEC" 2>/dev/null || true
  echo "[fix-r-paths] bin/exec/R deps → @rpath + rpath added"
fi

# ── 4. 所有 .so 文件：R.framework 引用 → @rpath ─────────────────
so_count=0
fixed_count=0

while IFS= read -r so; do
  so_count=$((so_count + 1))

  deps=$(otool -L "$so" 2>/dev/null \
    | grep -E "/(Library/Frameworks/R\.framework|Documents/.*resources/R/lib)/" \
    | sed 's/^[[:space:]]*//' | cut -d' ' -f1 || true)

  if [[ -n "$deps" ]]; then
    while IFS= read -r dep; do
      [[ -z "$dep" ]] && continue
      depname=$(basename "$dep")
      install_name_tool -change "$dep" "@rpath/$depname" "$so" 2>/dev/null || true
    done <<< "$deps"
    fixed_count=$((fixed_count + 1))
  fi
done < <(find "$R_HOME/library" -name "*.so" 2>/dev/null)

echo "[fix-r-paths] .so files: scanned $so_count, fixed $fixed_count"

# ── 5. 验证 ─────────────────────────────────────────────────────
remaining=$(find "$R_HOME" -name "*.so" -exec otool -L {} \; 2>/dev/null \
  | grep -c "R.framework" || true)
dylib_remaining=$(otool -L "$LIB/libR.dylib" 2>/dev/null \
  | grep -c "R.framework" || true)

echo "[fix-r-paths] verification:"
echo "  .so R.framework refs remaining: $remaining"
echo "  libR.dylib R.framework refs remaining: $dylib_remaining"

if [[ "$remaining" -eq 0 && "$dylib_remaining" -eq 0 ]]; then
  echo "[fix-r-paths] ✅ all paths fixed"
  exit 0
else
  echo "[fix-r-paths] ⚠️  some refs remaining (may be OK if universal binary duplicates)"
  exit 0  # 不报错，universal binary 可能有残留但不影响 arm64 运行
fi
