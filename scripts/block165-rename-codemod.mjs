#!/usr/bin/env node
// BLOCK-165 Petri 换库改名执行器（plan=docs/block165 对应 plan §5-§6）。
// 默认 dry-run 只出报告；--write 实际落盘（内容替换 + git mv 路径重命名，深先序）。
// 豁免：plan 文档自身 / 本脚本 / 幂等测试 / package-lock.json / acceptance/block-165/**；
// 行级豁免：任何包含 BLOCK-165-PETRI-OSS-RENAME 标记的行不改（保护台账里的旧名记述）。
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARKER = 'BLOCK-165';
const EXEMPT_FILES = new Set([
  'docs/block-165-petri-oss-rename-plan.md',
  'scripts/block165-rename-codemod.mjs',
  'test/block165-codemod-idempotent.test.mjs',
  'package-lock.json',
]);
const EXEMPT_PREFIXES = ['acceptance/block-165/'];
const BINARY_EXT = new Set([
  '.png', '.ico', '.icns', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.zip', '.gz', '.tgz', '.7z',
  '.node', '.exe', '.dll', '.dylib', '.so', '.rlib', '.pdf', '.mp3', '.mp4',
  '.wav', '.db', '.sqlite', '.wasm',
]);
// 优先于通用规则的整串特例（改名目标与通用规则形状不同时在此登记）
const SPECIAL_RULES = [
  [/github\.com\/ShengXinF3\/biof3-desktop/gi, 'github.com/petri-ops/Petri'],
];
const RE = /biof3|gewu/gi;

export function mapRenameCase(matched) {
  if (/^[A-Z]/.test(matched)) {
    return matched[1] && matched[1] === matched[1].toUpperCase() ? 'PETRI' : 'Petri';
  }
  return 'petri';
}

export function mapLine(line) {
  if (line.includes(MARKER)) return { text: line, changed: false, skippedMarker: true };
  let changed = false;
  let text = line;
  for (const [re, to] of SPECIAL_RULES) {
    const next = text.replace(re, () => { changed = true; return to; });
    if (next !== text) text = next;
  }
  const next = text.replace(RE, (m) => { changed = true; return mapRenameCase(m); });
  return { text: next, changed: changed || next !== line, skippedMarker: false };
}

function listTrackedFiles() {
  const out = execSync('git ls-files -z', { maxBuffer: 64 * 1024 * 1024 });
  return out.toString('utf8').split('\0').filter(Boolean);
}

function isExempt(f) {
  if (EXEMPT_FILES.has(f)) return true;
  if (EXEMPT_PREFIXES.some((p) => f.startsWith(p))) return true;
  const dot = f.lastIndexOf('.');
  if (dot > -1 && BINARY_EXT.has(f.slice(dot).toLowerCase())) return true;
  try { if (lstatSync(f).isSymbolicLink()) return true; } catch { /* untracked or gone */ }
  return false;
}

function run({ write, reportPath }) {
  const files = listTrackedFiles();
  const contentStats = { filesChanged: 0, occurrences: 0, markerLines: 0, byDir: new Map() };
  const renameDirs = [];
  const renameFiles = [];

  for (const f of files) {
    if (!RE.test(f) && !EXEMPT_FILES.has(f) === false) { /* noop */ }
    const exempt = isExempt(f);
    if (!exempt) {
      let text;
      try { text = readFileSync(f, 'utf8'); } catch { continue; }
      const lines = text.split('\n');
      let changed = false;
      let occ = 0;
      for (let i = 0; i < lines.length; i++) {
        const before = lines[i];
        const m = before.match(RE);
        if (m) occ += m.length;
        const r = mapLine(before);
        if (r.skippedMarker) contentStats.markerLines++;
        lines[i] = r.text;
        if (r.changed) changed = true;
      }
      if (changed) {
        contentStats.filesChanged++;
        contentStats.occurrences += occ;
        const dir = f.includes('/') ? f.slice(0, f.indexOf('/')) : '(root)';
        contentStats.byDir.set(dir, (contentStats.byDir.get(dir) || 0) + 1);
        if (write) writeFileSync(f, lines.join('\n'));
      }
    }
  }

  // 路径重命名：目录浅先序（祖先先改名，子路径随后重映射），再文件
  const matching = files.filter((f) => RE.test(f) && !EXEMPT_FILES.has(f));
  const dirSet = new Set();
  for (const p of matching) {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) {
      const d = parts.slice(0, i).join('/');
      if (RE.test(d)) dirSet.add(d);
    }
  }
  const applied = [];
  const remap = (p) => {
    for (const [a, b] of applied) {
      if (p === a) return b;
      if (p.startsWith(a + '/')) p = b + p.slice(a.length);
    }
    return p;
  };
  const dirs = [...dirSet].sort((a, b) => a.length - b.length);
  for (const d of dirs) {
    const rd = remap(d);
    if (!RE.test(rd)) continue;
    let st;
    try { st = lstatSync(rd); } catch { continue; }
    if (!st.isDirectory()) continue;
    const nd = rd.replace(RE, mapRenameCase);
    if (nd === rd) continue;
    renameDirs.push([rd, nd]);
    if (write) execSync(`git mv "${rd}" "${nd}"`);
    applied.push([rd, nd]);
  }
  for (const f of new Set(matching.map(remap))) {
    if (!RE.test(f)) continue;
    const nf = f.replace(RE, mapRenameCase);
    if (nf !== f) {
      renameFiles.push([f, nf]);
      if (write) execSync(`git mv "${f}" "${nf}"`);
    }
  }

  const report = {
    mode: write ? 'WRITE' : 'DRY-RUN',
    contentFilesChanged: contentStats.filesChanged,
    contentOccurrences: contentStats.occurrences,
    markerLinesProtected: contentStats.markerLines,
    renameDirs: renameDirs.length,
    renameFiles: renameFiles.length,
    byDir: Object.fromEntries([...contentStats.byDir.entries()].sort((a, b) => b[1] - a[1])),
    dirRenames: renameDirs,
    fileRenames: renameFiles,
    exemptFiles: [...EXEMPT_FILES],
    exemptPrefixes: EXEMPT_PREFIXES,
  };

  if (reportPath) {
    mkdirSync(dirname(reportPath), { recursive: true });
    const lines = [
      '# BLOCK-165 codemod ' + report.mode + ' 报告（' + new Date().toISOString() + '）',
      '',
      '<!-- BLOCK-165-PETRI-OSS-RENAME 证据文件：本文件记录旧名属预期，机械替换豁免 -->',
      '',
      '- 内容替换文件数：' + report.contentFilesChanged,
      '- 内容替换命中次数：' + report.contentOccurrences,
      '- 行级标记保护行数：' + report.markerLinesProtected,
      '- 目录重命名：' + report.renameDirs + ' 个',
      '- 文件重命名：' + report.renameFiles + ' 个',
      '- 按顶层目录分布：`' + JSON.stringify(report.byDir) + '`',
      '- 豁免文件：`' + report.exemptFiles.join('`, `') + '`',
      '- 豁免前缀：`' + report.exemptPrefixes.join('`, `') + '`',
      '',
      '## 目录重命名清单',
      '',
      ...report.dirRenames.map(([a, b]) => '- `' + a + '` → `' + b + '`'),
      '',
      '## 文件重命名清单',
      '',
      ...report.fileRenames.map(([a, b]) => '- `' + a + '` → `' + b + '`'),
      '',
    ];
    writeFileSync(reportPath, lines.join('\n'));
  }
  console.log('[block165-codemod] ' + report.mode +
    ' 内容文件=' + report.contentFilesChanged +
    ' 命中=' + report.contentOccurrences +
    ' 标记保护行=' + report.markerLinesProtected +
    ' 目录改名=' + report.renameDirs +
    ' 文件改名=' + report.renameFiles);
}

const isMain = (() => {
  try {
    if (!process.argv[1]) return false;
    const self = realpathSync(fileURLToPath(import.meta.url)).toLowerCase();
    const arg = realpathSync(resolve(process.argv[1])).toLowerCase();
    return self === arg;
  } catch { return false; }
})();
if (isMain) {
  run({
    write: process.argv.includes('--write'),
    reportPath: process.argv.includes('--report') ? process.argv[process.argv.indexOf('--report') + 1] : null,
  });
}
