#!/usr/bin/env node
'use strict';

/**
 * BLOCK-83 D7 基线刷新：重算核心生产代码的领域词残留并写回基线。
 *
 *   node scripts/d7-baseline.mjs            # 只报告（不写盘）
 *   node scripts/d7-baseline.mjs --update   # 写回 test/domain-neutrality-baseline.json
 *
 * 何时用：清理了残留（或新增了领域词且经裁决豁免）之后。基线即真相——
 * 门禁只拦「比基线更差」，基线不实就必须刷新，不允许长期漂移。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROOT = ROOT_DIR;
const BASELINE = path.join(ROOT, 'test/domain-neutrality-baseline.json');

(async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, 'test/helpers/domain-scan.mjs')).href);
  const current = mod.scanDomainResidue({ root: ROOT });
  const existing = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : { hits: {} };
  const { regressions, improvements } = mod.diffAgainstBaseline(current, existing.hits || {});

  console.log('[d7] 当前残留条目: ' + Object.keys(current).length);
  console.log('[d7] 新增/恶化: ' + regressions.length + ' | 减少: ' + improvements.length);
  for (const r of regressions.slice(0, 20)) console.log('  + ' + r.key + ' (' + r.baseline + ' → ' + r.count + ')');
  for (const i of improvements.slice(0, 20)) console.log('  - ' + i.key + ' (' + i.baseline + ' → ' + i.count + ')');
  const compatKeys = new Set((Array.isArray(existing.compat) ? existing.compat : []).map((entry) => entry.key));
  const unlisted = Object.keys(current).filter((key) => !compatKeys.has(key));
  if (unlisted.length > 0) {
    console.log('[d7] 新增键不在 compat 兼容白名单（门禁会红，需登记 category/reason/owner）: ' + unlisted.length);
    for (const key of unlisted.slice(0, 20)) console.log('  ! ' + key);
  }

  if (process.argv.includes('--update')) {
    const next = {
      ...existing,
      schemaVersion: 2,
      words: mod.DOMAIN_WORDS,
      hits: current,
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    fs.writeFileSync(BASELINE, JSON.stringify(next, null, 2) + '\n', 'utf8');
    console.log('[d7] 基线已刷新 → test/domain-neutrality-baseline.json');
  } else {
    console.log('[d7] 未写盘（加 --update 刷新）');
  }
})().catch((error) => {
  console.error('[d7] 失败: ' + error.message);
  process.exit(1);
});
