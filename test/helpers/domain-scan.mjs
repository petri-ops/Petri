/**
 * BLOCK-83 D7：领域中性化扫描器（核心生产代码的领域关键词残留）。
 *
 * 语义：核心（core/ + frontend/src/ + src/）只提供领域无关的机制与扩展点；
 * 领域能力随领域包（如生信包）交付。本扫描器给出「文件::词 → 次数」的
 * 确定性命中集，供棘轮门禁（test/domain-neutrality.test.mjs）比对基线。
 *
 * 扫描面刻意排除：测试文件、SQL 迁移（schema 留置裁决 D1）、插件目录、
 * node_modules、构建产物。注释按启发式剥离（不含 `://` 的 `//` 行尾注释 +
 * 块注释），使判定落在代码 token 上——URL 与协议头不会被误剥。
 */
import fs from 'node:fs';
import path from 'node:path';

export const DOMAIN_WORDS = [
  'seurat', 'deseq2', 'scanpy', 'cellchat', 'wgcna', 'celltypist', 'scvi',
  'gsea', 'go-kegg', 'km-survival', 'volcano', 'h5ad', 'scrna',
  'single-cell', '空间组学', '单细胞', '组学',
];

const SCAN_DIRS = ['core', 'frontend/src', 'src'];
const EXTS = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx']);
const SKIP_DIRS = ['node_modules', 'test', 'tests', '__tests__', 'migrations', 'dist', 'build'];
const SKIP_FILE_PATTERNS = [/\.test\./, /\.spec\./, /\.d\.ts$/];

export function stripComments(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  out = out.split(/\r?\n/).map((line) => {
    const idx = line.indexOf('//');
    if (idx === -1) return line;
    if (line[idx - 1] === ':') return line; // protocol:// 保活
    return line.slice(0, idx);
  }).join('\n');
  return out;
}

function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.includes(entry.name)) continue;
      walk(full, acc);
      continue;
    }
    if (!EXTS.has(path.extname(entry.name))) continue;
    if (SKIP_FILE_PATTERNS.some((re) => re.test(entry.name))) continue;
    acc.push(full);
  }
  return acc;
}

/** 返回 { '相对路径::词': 次数 }（按 key 排序，确定性）。 */
export function scanDomainResidue({ root }) {
  const hits = {};
  for (const dir of SCAN_DIRS) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const file of walk(abs, [])) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      const code = stripComments(fs.readFileSync(file, 'utf8')).toLowerCase();
      for (const word of DOMAIN_WORDS) {
        const needle = word.toLowerCase();
        let count = 0;
        let idx = code.indexOf(needle);
        while (idx !== -1) { count += 1; idx = code.indexOf(needle, idx + 1); }
        if (count > 0) hits[rel + '::' + word] = count;
      }
    }
  }
  return Object.fromEntries(Object.entries(hits).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** 与基线比对：{ regressions, improvements, unchanged }。 */
export function diffAgainstBaseline(current, baseline) {
  const regressions = [];
  const improvements = [];
  for (const [key, count] of Object.entries(current)) {
    const base = baseline[key];
    if (base == null) regressions.push({ key, count, baseline: 0, kind: 'new' });
    else if (count > base) regressions.push({ key, count, baseline: base, kind: 'increased' });
    else if (count < base) improvements.push({ key, count, baseline: base });
  }
  for (const [key, base] of Object.entries(baseline)) {
    if (current[key] == null) improvements.push({ key, count: 0, baseline: base });
  }
  return { regressions, improvements };
}
