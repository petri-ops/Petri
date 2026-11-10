#!/usr/bin/env node
/**
 * scripts/post-k7-readings-generate.mjs — L0-8（蓝图 L-45/L-76/L-81/L-84）：数字口径单源生成器。
 *
 * 产出 docs/post-k7-readings-single-source.json：全部易漂移读数（impact-map 规则数/未映射数、
 * DOC-REGISTRY 计数、测试文件三口径、证据元数据门读数、perf 基线、用户资产对账）当场实测
 * 生成，并登记「已作废的历史读数」（第四轮蓝图原件为未跟踪用户资产零触碰，旧读数在此
 * 作废而非回写）。文档引用一律指向本 JSON，不再手抄数字。
 *
 * 用法：node scripts/post-k7-readings-generate.mjs   # 生成 + 打印摘要（幂等，仅写 JSON）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'post-k7-readings-single-source.json');

const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const countFiles = (dir, re) => {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(path.join(d, e.name));
      else if (re.test(e.name)) n += 1;
    }
  };
  walk(dir);
  return n;
};

function main() {
  const impactMap = readJson('test/impact-map.json');
  const coverage = readJson('test/impact-map-coverage-baseline.json');
  const registry = readJson('docs/DOC-REGISTRY.json');
  const perf = readJson('test/perf-baseline.json');
  let evidenceGate = null;
  try { evidenceGate = readJson('acceptance/post-h9-2026-11-10/k5/k5-evidence-metadata-gate.json'); } catch { /* 如实留空 */ }
  let userAssets = null;
  try { userAssets = readJson('test/user-asset-guard-baseline.json'); } catch { /* 如实留空 */ }
  let head = '';
  try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { /* 非 git */ }

  const readings = {
    _about: '第五轮 L0-8 数字口径单源（蓝图 L-45/L-76/L-81/L-84）：文档引用读数一律以本 JSON 为准；由 scripts/post-k7-readings-generate.mjs 当场实测生成，禁止手抄/手改。',
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceCommit: head,
    generator: 'node scripts/post-k7-readings-generate.mjs',
    impactMap: {
      rules: (impactMap.rules || []).length,
      unmappedTests: (coverage.unmappedTests || []).length,
      coverageBaselineUpdatedAt: coverage.updatedAt || null,
      source: ['test/impact-map.json', 'test/impact-map-coverage-baseline.json'],
    },
    docRegistry: {
      documentCount: registry.coverage?.documentCount ?? null,
      managedMarkdown: registry.coverage?.managedMarkdown ?? null,
      registryLastUpdated: registry.coverage?.lastUpdated ?? null,
      source: 'docs/DOC-REGISTRY.json',
    },
    tests: {
      nodePhysicalTestFiles: countFiles(path.join(ROOT, 'test'), /\.test\.(mjs|cjs|js)$/),
      frontendTestFiles: countFiles(path.join(ROOT, 'frontend', 'src'), /\.test\.(ts|tsx)$/),
      unmappedTests: (coverage.unmappedTests || []).length,
      denominatorNote: '628 是三段分片清单读数（test:all:sharded 的清单长度口径），700 是物理 test/*.test.mjs 文件数——两个分母不得混用（L-84）。',
      source: ['test/', 'frontend/src/'],
    },
    evidenceMetadataGate: {
      fileCount: evidenceGate?.fileCount ?? null,
      negativeTests: evidenceGate?.negativeTests ?? null,
      generatedAt: evidenceGate?.generatedAt ?? null,
      authority: 'k5-evidence-metadata-gate.json（机械门读数）',
      supersededReadings: [
        { claim: '33 份 + 8 负测', source: 'docs/README.md 口径行（L-81）', status: 'voided-by-this-json' },
        { claim: '38 份 + 11 负测', source: 'docs/DOC-REGISTRY.json notes（L-81）', status: 'voided-by-this-json' },
      ],
    },
    perfBaseline: {
      generatedAt: perf.generatedAt || null,
      coreSha: perf.coreSha || null,
      host: perf.host || null,
      scenarios: Object.fromEntries(Object.entries(perf.scenarios || {}).map(([k, v]) => [k, {
        medianMs: v.medianMs ?? null, tolerancePct: v.tolerancePct ?? null, skipped: Boolean(v.skipped),
      }])),
      coldStartTrueLeg: perf.coldStartTrueLeg?.script || null,
      source: 'test/perf-baseline.json',
    },
    userAssets: {
      protectedPaths: (userAssets?.paths || []).length,
      paths: userAssets?.paths || [],
      incidents: (userAssets?.incidents || []).length,
      source: 'test/user-asset-guard-baseline.json',
      reconcileNote: 'L-83 对账：2026-11-10 审计登记 9 项可见条目，缺第四轮蓝图 docs/post-h9-optimization-blueprint-2026-11-10.md（registry 已 planned 的用户资产原件）；2026-11-11 补入保护清单至 10 项。',
    },
    staleReadings: [
      { claim: 'impact-map 365 规则 / 120 未映射', source: 'docs/post-h9-optimization-blueprint-2026-11-10.md（第四轮蓝图，未跟踪用户资产，不改原件）', status: 'voided-by-this-json', note: '以 impactMap.rules/unmappedTests 当次读数为准（L-45）' },
      { claim: 'DOC-REGISTRY 528/511', source: 'docs/post-h9-optimization-blueprint-2026-11-10.md', status: 'voided-by-this-json', note: '以 docRegistry 当次读数为准（L-45）' },
      { claim: '「约 700 个 .mjs（628 文件 / 5081 测试）」分母混用', source: 'docs/post-h9-optimization-blueprint-2026-11-10.md', status: 'voided-by-this-json', note: '628=分片清单、700=物理文件数，见 tests.denominatorNote（L-84）' },
      { claim: 'K-07「audit:compact 压回 50KB」', source: 'docs/post-h9-2026-11-10-final-report.md', status: 'recorded-as-partial', note: 'L-77：如未压回阈内，K-07 终态如实标注未完成（不抬阈值不改历史）' },
    ],
  };

  fs.writeFileSync(OUT, JSON.stringify(readings, null, 2) + '\n');
  console.log(`[post-k7-readings] 单源 JSON 已生成 ${path.relative(ROOT, OUT)}`);
  console.log(`  impact-map ${readings.impactMap.rules} 规则 / ${readings.impactMap.unmappedTests} 未映射；registry ${readings.docRegistry.documentCount}/${readings.docRegistry.managedMarkdown}；tests node=${readings.tests.nodePhysicalTestFiles} fe=${readings.tests.frontendTestFiles}；evidence ${readings.evidenceMetadataGate.fileCount} 份/${readings.evidenceMetadataGate.negativeTests} 负测；用户资产 ${readings.userAssets.protectedPaths} 项`);
}

main();
