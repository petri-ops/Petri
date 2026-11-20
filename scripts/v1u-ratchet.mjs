// V1-U ratchet 下调（只减不增）：只改 accent 棘轮断言块内的逐文件计数。
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'frontend/src';
const TEST = path.join(ROOT, 'styles/theme-token-contract.test.ts');
const counts = new Map();
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p);
  else if (p.endsWith('.css')) {
    const n = (fs.readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').match(/var\(--petri-accent\)/g) || []).length;
    if (n) counts.set(path.relative(ROOT, p), n);
  }
});
walk(ROOT);

const src = fs.readFileSync(TEST, 'utf8');
const startMarker = "it('accent usage holds the frozen ratchet";
const endMarker = "expectRatchet(RATCHET, countPerFile(/var\\(--petri-accent\\)/));";
const start = src.indexOf(startMarker);
const end = src.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('accent ratchet block not found');

const block = src.slice(start, end);
const changed = [];
const newBlock = block.split('\n').map((line) => {
  const m = line.match(/^(\s*)'([^']+\.css)':\s*(\d+)(.*)$/);
  if (!m) return line;
  const actual = counts.get(m[2]);
  if (actual === undefined || actual >= Number(m[3])) return line;
  changed.push(`${m[2]}:${m[3]}->${actual}`);
  return `${m[1]}'${m[2]}': ${actual}${m[4]}`;
}).join('\n');

fs.writeFileSync(TEST, src.slice(0, start) + newBlock + src.slice(end));
console.log(changed.join('\n') || 'none');
