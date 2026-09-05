#!/usr/bin/env bash
# BLOCK-48 P1 — 构建 Computer Use sidecar（SPM release → bin/ 稳定路径）。
# 二进制不入 git（.gitignore 已排除 .build/ 与 bin/）；宿主按 bin/ 路径 spawn。
set -euo pipefail
cd "$(dirname "$0")/../sidecars/computer-use"
swift build -c release
mkdir -p bin
cp -f .build/release/biof3-computer-use bin/biof3-computer-use
echo "built: $(pwd)/bin/biof3-computer-use"
