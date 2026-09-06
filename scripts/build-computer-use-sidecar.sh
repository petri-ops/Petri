#!/usr/bin/env bash
# BLOCK-48 — 构建 Computer Use sidecar + axfixture 测试靶（SPM release → bin/）。
# 二进制不入 git（.gitignore 已排除 .build/ 与 bin/）；宿主/测试按 bin/ 路径 spawn。
set -euo pipefail
cd "$(dirname "$0")/../sidecars/computer-use"
swift build -c release
mkdir -p bin
cp -f .build/release/gewu-computer-use bin/gewu-computer-use
cp -f .build/release/axfixture bin/axfixture
echo "built: $(pwd)/bin/gewu-computer-use + bin/axfixture"
