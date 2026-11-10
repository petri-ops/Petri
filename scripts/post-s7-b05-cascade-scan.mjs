#!/usr/bin/env node
/**
 * B-05 补腿：依赖 CASCADE 的 DELETE 语句清单静态扫描门。
 *
 * BLOCK-372/BLOCK-384 用户裁决 FK=ON 全量切换维持缓。切 FK=ON 前必须先证明
 * 「没有 DELETE 语句靠隐式 CASCADE 才正确」——否则切了会静默改变删除语义。
 * 本脚本只做只读清单，不改任何 DDL / DELETE，作为决策材料的机械证据。
 *
 * 用法：node scripts/post-s7-b05-cascade-scan.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCAN_DIRS = ['src/database', 'src/migrations', 'core/petri-server/db', 'core/petri-server/routes'];

export function classifySql(text) {
  const lines = text.split(/\r?\n/);
  const cascades = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (/ON DELETE CASCADE/i.test(lines[i])) cascades.push({ line: i + 1, ddl: lines[i].trim() });
  }
  return cascades;
}

export function evaluateCascadeScan(files) {
  const issues = [];
  const cascadeDdl = [];
  const deletes = [];
  for (const [file, text] of Object.entries(files)) {
    for (const row of classifySql(text)) cascadeDdl.push({ file, ...row });
    text.split(/\r?\n/).forEach((line, i) => {
      if (/^\s*(await\s+)?\w+(\.\w+)*\s*\.\s*(prepare|run|exec)\s*\(\s*[`'"]\s*DELETE\s+FROM/i.test(line)
        || /^\s*DELETE\s+FROM/i.test(line)) {
        deletes.push({ file, line: i + 1, sql: line.trim().slice(0, 160) });
      }
    });
  }
  return { cascades: cascadeDdl, deletes, ok: true, issues };
}

function walk(dir, out = {}) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(sql|js|mjs|cjs)$/.test(e.name)) out[p] = fs.readFileSync(path.join(ROOT, p), 'utf8');
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = {};
  for (const d of SCAN_DIRS) walk(d, files);
  const r = evaluateCascadeScan(files);
  const out = {
    schemaVersion: 1, kind: 'b05-cascade-dependency-scan',
    generatedAt: new Date().toISOString(),
    scannedFiles: Object.keys(files).length,
    cascadeDdlCount: r.cascades.length,
    explicitDeleteCount: r.deletes.length,
    cascades: r.cascades,
    deletes: r.deletes.slice(0, 60),
    note: '只读清单。FK=ON 全量切换仍需用户显式裁决（BLOCK-372/384）；本清单是决策材料，不是切换授权。',
  };
  const target = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/cascade-scan.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
  if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
  else console.log(`[b05] scanned=${out.scannedFiles} cascadeDDL=${out.cascadeDdlCount} explicitDELETE=${out.explicitDeleteCount} -> ${target}`);
}
