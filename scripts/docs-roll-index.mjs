#!/usr/bin/env node
/**
 * docs-roll-index.mjs — docs/README.md 编号条目按月滚动索引（治理 skill「Archive or
 * supersede documentation」条款的机械执行体；幂等可重跑）。
 *
 * 规则（README「## 维护规则」同步条款）：
 * - README 只承载当月（--keep-month，缺省当前月）编号条目 + 导航区；
 * - 其余条目按月迁入 docs/doc-index-YYYY-MM.md（搬移不改写，已存在的行不重复）；
 * - 迁出文档的 DOC-REGISTRY entrypoint（docs/README.md → 所在索引）按「链接在场」
 *   改指：宿主条目与嵌在描述文本内的链接一律按链接实际归属处理（2026-10-13
 *   README 瘦身批抓真的嵌链边缘，测试钉住）；
 * - 新索引文件自动注册 DOC-REGISTRY（kind=governance, canonical=false）；
 * - 无日期条目保守留 README 并如实报告。
 *
 * 用法：npm run docs:roll-index [-- --check] [-- --keep-month=YYYY-MM]
 *   --check  预览模式：只报告将发生的迁移，不写任何文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY_RE = /^(\d+)\.\s+\[`([^`]+)`\]\((\.[^)]+)\)\s+—?\s*(.*)$/;
const INDEX_PREFIX = 'doc-index-';

export function extractLocalMarkdownLinks(markdown, sourcePath) {
  const links = [];
  const pattern = /\[[^\]]*\]\(([^)]+)\)/g;
  let match;
  while ((match = pattern.exec(markdown)) !== null) {
    let target = match[1].trim();
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1);
    target = target.split(/\s+["']/)[0];
    target = target.split('#')[0].split('?')[0];
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    if (target.startsWith('/')) continue;
    links.push(path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), target)));
  }
  return links;
}

function normalizeDocPath(linkTarget) {
  return path.posix.normalize(path.posix.join('docs', linkTarget));
}

function monthOf(entryText) {
  const m = entryText.match(/(20\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function indexFileFor(month) {
  return `docs/${INDEX_PREFIX}${month}.md`;
}

export function planRoll({ readmeText, keepMonth }) {
  const lines = readmeText.split('\n');
  const moves = new Map(); // month -> { lines: [], paths: Set }
  const keep = [];
  const undated = [];
  const outLines = [];
  for (const line of lines) {
    const m = line.match(ENTRY_RE);
    if (!m) {
      outLines.push(line);
      continue;
    }
    const month = monthOf(line);
    if (!month) {
      undated.push(`${m[1]} ${m[3]}`);
      outLines.push(line);
      continue;
    }
    if (month === keepMonth) {
      keep.push(month);
      outLines.push(line);
      continue;
    }
    if (!moves.has(month)) moves.set(month, { lines: [], paths: new Set() });
    const bucket = moves.get(month);
    bucket.lines.push(line);
    bucket.paths.add(normalizeDocPath(m[3]));
  }
  return { outLines, moves, keep, undated };
}

function buildIndexContent(month, bucket) {
  return [
    `# ${month} 工作包条目索引`,
    '',
    `> README 编号条目按月滚动索引（${month} 段；docs-roll-index 迁入，搬移不改写零删除）。`,
    '> 本文件是段内各 canonical 文档的声明入口（DOC-REGISTRY entrypoint 指向此处）；',
    '> 追溯历史工作包时按需读取，不属于默认启动上下文。',
    `> 当月条目见 [README.md](./README.md)；滚动执行 \`npm run docs:roll-index\`。`,
    '',
    ...bucket.lines,
    '',
  ].join('\n');
}

function upsertIndexLinkBlock(readmeText, months) {
  const linkLines = months.map((month) => {
    const rel = `${INDEX_PREFIX}${month}.md`;
    return `- [\`${rel}\`](./${rel}) — ${month} 工作包条目索引（搬移不改写）。`;
  });
  const header = '**工作包条目按月索引（历史段，按需读取，不入默认启动上下文）**';
  if (readmeText.includes(header)) {
    // 已有块：把缺失的链接行补到块尾（幂等）
    const lines = readmeText.split('\n');
    const headerIdx = lines.findIndex((l) => l.includes(header));
    let insertAt = headerIdx + 1;
    while (insertAt < lines.length && lines[insertAt].startsWith('- [')) insertAt += 1;
    const existing = new Set(lines.slice(headerIdx + 1, insertAt));
    const missing = linkLines.filter((l) => !existing.has(l));
    if (missing.length === 0) return readmeText;
    lines.splice(insertAt, 0, ...missing);
    return lines.join('\n');
  }
  const anchor = readmeText.indexOf('## 历史归档');
  if (anchor < 0) {
    // 无「历史归档」锚点（非本项目形态）：追加文件尾，不静默丢块
    return readmeText.replace(/\n*$/, '\n\n') + `${header}\n\n${linkLines.join('\n')}\n`;
  }
  const insertAt = readmeText.indexOf('\n\n', anchor);
  return readmeText.slice(0, insertAt)
    + `\n\n${header}\n\n${linkLines.join('\n')}`
    + readmeText.slice(insertAt);
}

/**
 * 执行一次滚动。write=false 为预览（--check）。返回报告，不改日志全局状态。
 */
export function rollDocsIndex({ rootDir, keepMonth, write = true }) {
  const readmePath = path.join(rootDir, 'docs', 'README.md');
  const registryPath = path.join(rootDir, 'docs', 'DOC-REGISTRY.json');
  const readmeText = fs.readFileSync(readmePath, 'utf8');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));

  const { outLines, moves, keep, undated } = planRoll({ readmeText, keepMonth });
  const report = {
    keepMonth,
    keptEntries: keep.length,
    undatedEntries: undated.length,
    movedMonths: [...moves.keys()],
    movedEntries: [...moves.values()].reduce((n, b) => n + b.lines.length, 0),
    entrypointsRemapped: 0,
    indexesRegistered: 0,
    write,
  };

  if (moves.size === 0) {
    report.aligned = true;
    return report;
  }

  let nextReadme = outLines.join('\n');
  for (const [month, bucket] of moves) {
    const rel = indexFileFor(month);
    const abs = path.join(rootDir, rel);
    let merged = buildIndexContent(month, bucket);
    if (fs.existsSync(abs)) {
      const existing = fs.readFileSync(abs, 'utf8');
      const existingLines = new Set(existing.split('\n'));
      const fresh = bucket.lines.filter((l) => !existingLines.has(l));
      if (fresh.length === 0) {
        merged = existing;
      } else {
        merged = existing.replace(/\n*$/, '\n') + fresh.join('\n') + '\n';
      }
    }
    if (write) fs.writeFileSync(abs, merged);
  }

  nextReadme = upsertIndexLinkBlock(nextReadme, [...moves.keys()]);

  // registry：①新索引注册；②entrypoint 按「README 已不链接 + 索引链接在场」改指。
  // 改指映射扫索引文件的实际链接（含嵌在宿主条目描述文本内的链接），不只看宿主路径。
  for (const [month] of moves) {
    const rel = indexFileFor(month);
    if (!registry.documents.some((d) => d.path === rel)) {
      registry.documents.push({
        id: `DOC-INDEX-${month.toUpperCase()}`,
        path: rel,
        kind: 'governance',
        status: 'active',
        canonical: false,
        archivePolicy: 'retain_stable_path',
      });
      report.indexesRegistered += 1;
    }
  }
  const readmeLinks = new Set(extractLocalMarkdownLinks(nextReadme, 'docs/README.md'));
  const indexLinkOwners = new Map(); // docPath -> indexFile（首个含其链接的索引）
  for (const [month] of moves) {
    const rel = indexFileFor(month);
    const abs = path.join(rootDir, rel);
    const content = write ? fs.readFileSync(abs, 'utf8') : buildIndexContent(month, moves.get(month));
    for (const link of extractLocalMarkdownLinks(content, rel)) {
      if (!indexLinkOwners.has(link)) indexLinkOwners.set(link, rel);
    }
  }
  for (const doc of registry.documents) {
    if (doc.canonical !== true || doc.entrypoint !== 'docs/README.md' || !doc.path) continue;
    if (readmeLinks.has(doc.path)) continue;
    const idx = indexLinkOwners.get(doc.path);
    if (idx) {
      doc.entrypoint = idx;
      report.entrypointsRemapped += 1;
    }
  }

  if (write) {
    fs.writeFileSync(readmePath, nextReadme);
    registry.documentCount = registry.documents.length;
    registry.lastUpdated = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
  }
  report.aligned = false;
  return report;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const keepArg = args.find((a) => a.startsWith('--keep-month='));
  const keepMonth = keepArg ? keepArg.split('=')[1] : currentMonth();
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const report = rollDocsIndex({ rootDir, keepMonth, write: !check });
  const tag = check ? '[check]' : '[roll]';
  if (report.aligned) {
    console.log(`${tag} 已是对齐状态：当月 ${report.keptEntries} 条全保留，无待迁移条目`);
    return;
  }
  console.log(`${tag} keepMonth=${report.keepMonth} 迁移 ${report.movedEntries} 条 → ${report.movedMonths.map((m) => indexFileFor(m)).join(', ')}`);
  console.log(`${tag} entrypoint 改指 ${report.entrypointsRemapped}，索引注册 ${report.indexesRegistered}，当月保留 ${report.keptEntries}，无日期留置 ${report.undatedEntries}${check ? '（预览未写入）' : ''}`);
}

if (process.argv[1] && process.argv[1].endsWith('docs-roll-index.mjs')) {
  main();
}
