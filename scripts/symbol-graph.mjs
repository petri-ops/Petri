#!/usr/bin/env node
// HK-03 P1 — symbol-graph CLI（dev 轨薄壳；BLOCK-124 起内核单源在 core）：
//   node scripts/symbol-graph.mjs who-imports <symbol>
//   node scripts/symbol-graph.mjs classify-edges <file>
// 内核：core/biof3-server/helpers/code-graph.js（选型 docs/hk03-symbol-graph-selection.md；
// 诚实盲区=变量形式动态 require/按路径动态调用/字符串引用 → UNRESOLVED，不猜测）。
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const { buildGraph, whoImports, classifyEdges } = require_('../core/biof3-server/helpers/code-graph.js');

// CLI 同步语义（yieldEvery=0）：命令行单进程无需让位事件循环
async function main() {
  const [, , cmd, arg] = process.argv;
  if (!cmd || !arg) {
    console.error('用法: node scripts/symbol-graph.mjs who-imports <symbol> | classify-edges <file>');
    process.exit(1);
  }
  const graph = await buildGraph(process.cwd(), { yieldEvery: 0 });
  if (graph.parseErrors.length) {
    for (const p of graph.parseErrors) console.error(`  [parse-error] ${p.file}: ${p.error}`);
  }
  if (cmd === 'who-imports') {
    for (const h of whoImports(graph, arg)) {
      console.log(`${h.kind.padEnd(10)} ${h.file}  [${h.symbol}]  ${h.specifier} -> ${h.target ?? (h.external ? '(external)' : 'UNRESOLVED')}`);
    }
  } else if (cmd === 'classify-edges') {
    const r = classifyEdges(graph, resolve(arg));
    for (const e of r.exports) {
      const imp = e.usedBy.map((u) => u.file).join(', ') || '-';
      console.log(`${e.status.padEnd(10)} ${r.file}::${e.name}  <- ${imp}${e.importedByUnused.length ? `  (导入未用: ${e.importedByUnused.map((u) => u.file).join(', ')})` : ''}`);
    }
    for (const o of r.outbound) {
      console.log(`  out ${o.kind} ${o.specifier ?? '(unresolved)'} -> ${o.target ?? (o.external ? '(external)' : 'UNRESOLVED')}  used=[${o.usedSymbols.join(', ')}]`);
    }
  } else {
    console.error(`未知命令: ${cmd}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
