#!/usr/bin/env node
/**
 * block211-pack-unlock-live.mjs — W8 收尾第二轮：领域包到位后的解锁验收。
 *
 * 前置：dev 后端在 :3001 运行，且启动时设置了
 *   PETRI_PLUGINS_DIR=<pack>/plugins
 *   PETRI_PACK_DIRS=<pack>
 * 用法：node scripts/block211-pack-unlock-live.mjs
 * 证据：acceptance/block-211/pack-unlock-live.json
 *
 * 断言的是"位置可配 + 判据不变"的实机事实：
 *   1) 兄弟仓 pack 通过 validatePackDir 全量校验；
 *   2) tools/catalog 不再是 0（插件硬依赖到位）；
 *   3) deg-analysis-standard 的插件依赖解析为 available；
 *   4) 真缺失的插件（scanpy-advanced / seurat-standard，仍休眠）如实报 missingPlugins，
 *      证明 preflight 不是"有 pack 就一律绿"。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packRegistry = require('../core/shared-backend/pack-registry.js');

const BASE = process.env.PETRI_API_BASE || 'http://127.0.0.1:3001';
const TOKEN = process.env.PETRI_DESKTOP_TOKEN || 'desktop-local';
const OUT = path.join(root, 'acceptance', 'block-211');
const OUT_FILE = path.join(OUT, 'pack-unlock-live.json');

async function getJson(route) {
  const res = await fetch(`${BASE}${route}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 400) };
  }
  return { status: res.status, json };
}

async function main() {
  const available = packRegistry.discoverAvailablePacks({ projectRoot: root });
  const pack = available.find((item) => item.packId === 'petri-pack-bio') || available[0] || null;

  const catalogRes = await getJson('/api/tools/catalog');
  const preflightRes = await getJson('/api/skills/preflight');

  const catalog = Array.isArray(catalogRes.json?.catalog) ? catalogRes.json.catalog : [];
  const preflight = preflightRes.json?.results || {};
  const deg = preflight['deg-analysis-standard'] || null;
  const sc = preflight['sc-analysis-standard'] || null;

  const checks = [
    {
      name: 'pack_discovered_and_validated',
      pass: Boolean(pack && pack.packRoot),
      detail: pack ? { packId: pack.packId, version: pack.version, packRoot: pack.packRoot } : null,
    },
    {
      name: 'tools_catalog_non_empty',
      pass: catalogRes.status === 200 && catalog.length > 0,
      detail: { status: catalogRes.status, count: catalog.length, ids: catalog.map((item) => item.id) },
    },
    {
      name: 'deg_analysis_plugin_deps_available',
      pass: deg?.status === 'available' && Array.isArray(deg?.missingPlugins) && deg.missingPlugins.length === 0,
      detail: deg,
    },
    {
      name: 'genuinely_missing_plugins_still_reported',
      pass: sc?.status === 'missing_deps'
        && Array.isArray(sc?.missingPlugins)
        && sc.missingPlugins.includes('scanpy-advanced')
        && sc.missingPlugins.includes('seurat-standard'),
      detail: sc,
    },
  ];

  const evidence = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    pack,
    catalog: { count: catalog.length, ids: catalog.map((item) => item.id) },
    preflight: { degAnalysisStandard: deg, scAnalysisStandard: sc },
    checks,
    allPass: checks.every((check) => check.pass),
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(evidence, null, 2) + '\n', 'utf-8');

  for (const check of checks) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'} ${check.name}`);
  }
  console.log(`evidence: ${path.relative(root, OUT_FILE)}`);

  if (!evidence.allPass) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
