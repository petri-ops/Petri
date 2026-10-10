#!/usr/bin/env bash
# platform: darwin（BLOCK-104 P4 双端同形门）
# BLOCK-48 — 构建 Computer Use sidecar + axfixture 测试靶（SPM release → bin/）。
# 二进制不入 git（.gitignore 已排除 .build/ 与 bin/）；宿主/测试按 bin/ 路径 spawn。
set -euo pipefail
cd "$(dirname "$0")/../sidecars/computer-use"
swift build -c release
mkdir -p bin
cp -f .build/release/petri-computer-use bin/petri-computer-use
cp -f .build/release/axfixture bin/axfixture
echo "built: $(pwd)/bin/petri-computer-use + bin/axfixture"
