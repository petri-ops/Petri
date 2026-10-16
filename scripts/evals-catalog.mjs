#!/usr/bin/env node
/**
 * scripts/evals-catalog.mjs — 生成 evals/CATALOG.md（BLOCK-190 catalog 五列化）。
 * 用法：npm run evals:catalog [-- --check]（--check 只校验不落盘，红=与生成物不一致）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCatalog } from './lib/evals-catalog.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'evals', 'CATALOG.md');
const content = renderCatalog() + '\n';
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (cur !== content) {
    console.error('[evals-catalog] ✖ CATALOG.md 与套件生成物不一致——跑 npm run evals:catalog 重生成（棘轮：新增/改任务须同步目录）');
    process.exit(1);
  }
  console.log('[evals-catalog] ✔ CATALOG.md 与套件同步');
  process.exit(0);
}
fs.writeFileSync(out, content);
console.log(`[evals-catalog] 生成 ${path.relative(root, out)}（${content.split('\n').length} 行）`);
