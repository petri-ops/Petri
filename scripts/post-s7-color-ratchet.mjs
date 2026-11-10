#!/usr/bin/env node
/**
 * B-32 颜色字面量收敛的**机械门**（不需要人眼）。
 *
 * 判据分域（不做「一刀切禁字面量」：token 定义本身必须写字面量才成立）：
 *   - token 定义处（`--petri-*`/`--ifm-*`: #xxx）= 合法，不计债；
 *   - 生产组件/页面 CSS 里的 hex/rgb() 字面量 = 债，按文件冻结；
 *   - 注释里的字面量不算（stripComments）。
 * 新增债即红；清零后 --write 下调基线（只减不增）。
 * 截图 diff / 暗色态观感仍待人眼，本门不冒充视觉绿。
 *
 * 用法：node scripts/post-s7-color-ratchet.mjs [--write] [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/color-baseline.json');
const CSS_ROOT = path.join(ROOT, 'frontend/src');

export const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d+\s*,/g;
export const TOKEN_DEF_RE = /^\s*--[\w-]+\s*:/;

export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^\S\r\n])\/\/.*$/gm, '$1');
}

export function scanColorDebt(files) {
  const perFile = {};
  for (const [file, text] of Object.entries(files)) {
    const clean = stripComments(text);
    const hits = [];
    clean.split(/\r?\n/).forEach((line, i) => {
      if (TOKEN_DEF_RE.test(line)) return; // token 定义合法
      const m = line.match(COLOR_RE);
      if (m) hits.push({ line: i + 1, literals: m });
    });
    if (hits.length) perFile[file] = hits.length;
  }
  return perFile;
}

export function evaluate(perFile, baseline) {
  const issues = [];
  const b = baseline?.perFile || {};
  for (const [file, count] of Object.entries(perFile)) {
    if (!Object.prototype.hasOwnProperty.call(b, file)) issues.push(`${file}: 新文件引入 ${count} 处颜色字面量`);
    else if (count > b[file]) issues.push(`${file}: ${b[file]} → ${count}（新增 ${count - b[file]} 处，棘轮只减不增）`);
  }
  return { ok: issues.length === 0, issues, total: Object.values(perFile).reduce((a, c) => a + c, 0), perFile };
}

function walk(dir, out = {}) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(abs, out); continue; }
    if (!/\.(css|scss)$/.test(e.name)) continue;
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    out[rel] = fs.readFileSync(abs, 'utf8');
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = walk(CSS_ROOT);
  const perFile = scanColorDebt(files);
  const baseline = fs.existsSync(BASE) ? JSON.parse(fs.readFileSync(BASE, 'utf8')) : null;
  const r = evaluate(perFile, baseline);
  if (process.argv.includes('--write')) {
    fs.mkdirSync(path.dirname(BASE), { recursive: true });
    fs.writeFileSync(BASE, JSON.stringify({
      schemaVersion: 1, kind: 'post-s7-color-literal-baseline', generatedAt: new Date().toISOString(),
      note: '按文件冻结颜色字面量债（token 定义不计）。只减不增；清零后重打。截图 diff/暗色观感仍待人眼。',
      perFile, total: r.total,
    }, null, 2) + '\n');
    console.log(`[color-ratchet] baseline written (${Object.keys(perFile).length} files / ${r.total} literals)`);
  } else if (process.argv.includes('--json')) console.log(JSON.stringify({ ...r, perFile }, null, 2));
  else {
    console.log(`[color-ratchet] ${r.ok ? 'PASS' : 'FAIL'} — ${Object.keys(perFile).length} 文件 / ${r.total} 处字面量债`);
    for (const i of r.issues) console.log(`  - ${i}`);
    process.exitCode = r.ok ? 0 : 1;
  }
}
