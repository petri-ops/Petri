#!/usr/bin/env bash
# platform: posix（bash/npm 工具链脚本，MSYS/Git-Bash 下同构可跑；BLOCK-165 全量复验补登记）
# quality-baseline.sh — BLOCK-105 P0 四项体检基线重扫（可复跑）
#
# 用法: bash scripts/quality-baseline.sh
# 产出: acceptance/block-105/baseline-<日期>/（Knip/jscpd/audit/密钥扫 原始输出 + 对比上一基线的摘要）
# 纪律: 只读体检，零产品代码改动；结果与上一基线对比后由人裁决是否更新 p0-baseline/ 正式基线。
set -u
cd "$(dirname "$0")/.." || exit 2

STAMP=$(date +%Y%m%d)
OUT="acceptance/block-105/baseline-$STAMP"
PREV="acceptance/block-105/p0-baseline"
mkdir -p "$OUT"

echo "== 1/4 密钥快扫 =="
node "$(dirname "$0")/secret-scan.mjs" > "$OUT/secret-scan.txt" 2>&1 || true

echo "== 2/4 npm audit（根 + 前端）=="
npm audit --json > "$OUT/audit-root.json" 2>&1 || true
npm --prefix frontend audit --json > "$OUT/audit-frontend.json" 2>&1 || true

echo "== 3/4 Knip（死代码，knip.json 校准入入口）=="
npx --yes knip@latest --reporter json --no-exit-code > "$OUT/knip.json" 2>"$OUT/knip-stderr.txt" || true

echo "== 4/4 jscpd（重复率）=="
npx --yes jscpd@latest src core frontend/src --min-tokens 50 --reporters json --output "$OUT/jscpd" --silent --format "javascript,typescript" > "$OUT/jscpd-console.txt" 2>&1 || true

echo ""
echo "== 摘要 =="
python3 - << 'PYEOF'
import json, io, os, glob

out_dir = sorted(glob.glob('acceptance/block-105/baseline-*'))[-1]

try:
    root = json.load(io.open(f'{out_dir}/audit-root.json', encoding='utf-8')).get('metadata', {}).get('vulnerabilities', {})
    fe = json.load(io.open(f'{out_dir}/audit-frontend.json', encoding='utf-8')).get('metadata', {}).get('vulnerabilities', {})
    print(f"audit: root total={root.get('total')} | frontend total={fe.get('total')}")
except Exception as e:
    print('audit: 解析失败', e)

try:
    k = json.load(io.open(f'{out_dir}/knip.json', encoding='utf-8'))
    c = {}
    for f in k['issues']:
        for cat, items in f.items():
            if cat != 'file':
                c[cat] = c.get(cat, 0) + len(items)
    top = sorted(c.items(), key=lambda x: -x[1])[:4]
    print(f"knip: files={sum(1 for f in k['issues'] if any(f[k2] for k2 in f if k2 != 'file'))} top={top}")
except Exception as e:
    print('knip: 解析失败', e)

try:
    j = json.load(io.open(f'{out_dir}/jscpd/jscpd-report.json', encoding='utf-8'))
    s = j['statistics']['total']
    print(f"jscpd: {s.get('duplicates')}% ({s.get('duplicatedLines')}/{s.get('lines')} 行, {s.get('clones')} 簇)")
except Exception as e:
    print('jscpd: 解析失败', e)

sec = io.open(f'{out_dir}/secret-scan.txt', encoding='utf-8').read() if os.path.exists(f'{out_dir}/secret-scan.txt') else ''
print('secret: 见', f'{out_dir}/secret-scan.txt', '（生产面命中行数 =', sec.count('[LEAK'), '）')

print()
print('对比上一正式基线: acceptance/block-105/p0-baseline/SUMMARY.md')
print(f'原始输出目录: {out_dir}/（人工裁决后才更新 p0-baseline/ 正式基线）')
PYEOF
