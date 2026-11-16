#!/usr/bin/env bash
# platform: darwin（macOS 桌面版更新源发布；Linux ECS 侧由 nginx 提供静态服务）
# Petri Desktop — 发布 macOS 更新包到阿里云 ECS 静态源（www.biof3.com/updates/macos/）。
#
# 与 OSS 方案的区别：ECS 走 SSH/scp（复用 ~/.ssh/config 的 aliyun 别名），
# 不需要 OSS AccessKey；证书复用 ECS 上 acme.sh 的 biof3.com 正规证书。
#
# 安全顺序（与 OSS 方案一致）：先传带版本号的不变文件（DMG / checksums），
# 最后原子传 latest-mac.yml 清单——避免客户端看到半发布状态。
#
# 用法：
#   bash scripts/publish-macos-ecs.sh --dry-run     # 预览将上传的对象与顺序
#   bash scripts/publish-macos-ecs.sh               # 执行上传
# 环境变量：
#   PETRI_ECS_HOST   SSH 别名（默认 aliyun）
#   PETRI_ECS_ROOT   远端 docroot（默认 /var/www/petri-updates/macos）
#   PETRI_FEED_URL   客户端 feed URL（默认 https://www.biof3.com/updates/macos/）

set -euo pipefail
cd "$(dirname "$0")/.." || exit 2

DRY_RUN=0
if [[ "${1:-}" == "--dry-run" ]]; then DRY_RUN=1; fi

ECS_HOST="${PETRI_ECS_HOST:-aliyun}"
ECS_ROOT="${PETRI_ECS_ROOT:-/var/www/petri-updates/macos}"
FEED_URL="${PETRI_FEED_URL:-https://www.biof3.com/updates/macos/}"

VERSION="$(node -e "process.stdout.write(require('./package.json').version)")"
DMG="dist/Petri-${VERSION}-arm64.dmg"
MANIFEST="dist/latest-mac.yml"
CHECKSUMS="dist/SHA256SUMS-mac-${VERSION}.txt"

echo "[publish-ecs] version=$VERSION feed=$FEED_URL"
echo "[publish-ecs] host=$ECS_HOST root=$ECS_ROOT"

if [[ ! -f "$DMG" ]]; then echo "[publish-ecs] MISSING $DMG — 先跑 npm run build:mac-arm64" >&2; exit 1; fi
if [[ ! -f "$MANIFEST" ]]; then echo "[publish-ecs] MISSING $MANIFEST" >&2; exit 1; fi

# 生成 SHA256 清单（发布文件之一）
( cd dist && shasum -a 256 "$(basename "$DMG")" > "$(basename "$CHECKSUMS")" )

# 校验 manifest 指向的 sha512/size 与本地 DMG 一致（fail-closed）
node -e '
const fs=require("fs"),crypto=require("crypto");
const m=fs.readFileSync(process.argv[1],"utf8");
const url=(m.match(/url:\s*(\S+)/)||[])[1];
const sha=(m.match(/sha512:\s*(\S+)/)||[])[1];
if(url!==process.argv[2]) throw new Error("manifest url mismatch: "+url);
const buf=fs.readFileSync(process.argv[3]);
const actual=crypto.createHash("sha512").update(buf).digest("base64");
if(actual!==sha) throw new Error("manifest sha512 mismatch");
console.log("[publish-ecs] manifest sha512 OK, size="+buf.length);
' "$MANIFEST" "$(basename "$DMG")" "$DMG"

echo "[publish-ecs] UPLOAD ORDER (atomic):"
echo "  1. $DMG"
echo "  2. $CHECKSUMS"
echo "  3. $MANIFEST  (last — clients read this to discover updates)"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "[publish-ecs] DRY RUN — 未执行上传"
  exit 0
fi

# 确认 SSH 可达（BatchMode 免交互，失败即停）
ssh -o BatchMode=yes -o ConnectTimeout=10 "$ECS_HOST" "test -d '$ECS_ROOT'" \
  || { echo "[publish-ecs] SSH/docroot 不可达" >&2; exit 1; }

# 1) DMG（带版本号，可长缓存）
scp -o BatchMode=yes "$DMG" "${ECS_HOST}:${ECS_ROOT}/"
# 2) SHA256 清单
scp -o BatchMode=yes "$CHECKSUMS" "${ECS_HOST}:${ECS_ROOT}/"
# 3) latest-mac.yml 原子最后上传（先临时名再 mv，避免半文件被读到）
scp -o BatchMode=yes "$MANIFEST" "${ECS_HOST}:${ECS_ROOT}/latest-mac.yml.tmp"
ssh -o BatchMode=yes "$ECS_HOST" "mv -f '${ECS_ROOT}/latest-mac.yml.tmp' '${ECS_ROOT}/latest-mac.yml'"

echo "[publish-ecs] 上传完成。验证："
echo "  curl -sI $FEED_URL/latest-mac.yml"
curl -s --noproxy '*' -o /dev/null -w "  latest-mac.yml => HTTP %{http_code}\n" --max-time 10 "${FEED_URL}latest-mac.yml"
curl -s --noproxy '*' -o /dev/null -w "  ${VERSION} DMG => HTTP %{http_code}\n" --max-time 15 "${FEED_URL}$(basename "$DMG")"
echo "[publish-ecs] complete"
