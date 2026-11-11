/**
 * BLOCK-413（补腿批第二刀 · 主题门扩面）契约测试。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('L6-4 源码锚：主题门两新棘轮在场（数字 z-index 全源 / 内联颜色全量 .tsx）', () => {
  const src = read('frontend/src/styles/theme-token-contract.test.ts');
  assert.match(src, /holds no digital z-index beyond the frozen ratchet across tsx\/ts\/css \(BLOCK-413 L-66\/L-71 棘轮\)/);
  assert.match(src, /holds inline color literals across all tsx to the frozen ratchet \(BLOCK-413 L-67 全量扫描\)/);
});

test('L6-4 植入必红（模拟）：计数正则对合成违规样本命中——新增 z-index/颜色即红的机制自证', () => {
  const zRe = /z-?[Ii]ndex\s*:\s*(?!["'`]?\s*var\()\d/g;
  const cRe = /#[0-9a-fA-F]{6}\b|rgba?\(\s*\d{1,3}/g;
  assert.equal(('div { z-index: 999; }'.match(zRe) || []).length, 1, '合成 z-index 命中');
  assert.equal(('div { color: #ff0000; }'.match(cRe) || []).length, 1, '合成颜色命中');
  assert.equal(('div { z-index: var(--petri-z-modal); }'.match(zRe) || []).length, 0, 'token 形态不命中（棘轮只罚字面量）');
});

test('L6-4 棘轮绿态：真实树 z-index 未超冻结基线（node 侧独立重算=vitest 误绿防线）', async () => {
  const srcRoot = path.join(ROOT, 'frontend', 'src');
  const walk = (dir) => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { out.push(...walk(full)); continue; }
      if (!/\.(css|ts|tsx|js|jsx)$/.test(e.name)) continue;
      if (/\.test\.(ts|tsx|js|jsx)$/.test(e.name) || /\.spec\./.test(e.name)) continue;
      out.push(full);
    }
    return out;
  };
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^\S\r\n])\/\/.*$/gm, '$1');
  const re = /z-?[Ii]ndex\s*:\s*(?!["'`]?\s*var\()\d/g;
  const total = {};
  for (const f of walk(srcRoot)) {
    const text = strip(fs.readFileSync(f, 'utf8'));
    const n = (text.match(re) || []).length;
    if (n > 0) {
      const rel = path.relative(srcRoot, f).replaceAll('\\', '/');
      total[rel] = (total[rel] || 0) + n;
    }
  }
  const themeTest = read('frontend/src/styles/theme-token-contract.test.ts');
  // 只取本棘轮对象段（到下一 it 边界为止——跨块解析会键冲突 last-wins）
  const ratchetBlock = themeTest.slice(themeTest.indexOf('holds no digital z-index beyond the frozen ratchet'), themeTest.indexOf('holds inline color literals across all tsx'));
  const baseline = {};
  for (const m of ratchetBlock.matchAll(/'([^']+)':\s*(\d+)/g)) baseline[m[1]] = Number(m[2]);
  const problems = Object.keys(total).filter((k) => total[k] > (baseline[k] || 0));
  assert.deepEqual(problems, [], `超基线：${problems.join(', ')}`);
});

test('L-67：k3 五文件基线保持（全量扫描为超集覆盖，不改 k3 冻结）', () => {
  const k3 = read('scripts/lib/post-h9-k3-experience.mjs');
  assert.match(k3, /INLINE_DEBT_FILES/, 'k3 冻结清单未被改写');
  const themeTest = read('frontend/src/styles/theme-token-contract.test.ts');
  const colorRatchet = themeTest.slice(themeTest.indexOf('holds inline color literals across all tsx'));
  for (const f of ['ContextBudgetBar', 'OrchestrationGraph', 'ChatArtifactCard', 'PluginStorePanel']) {
    assert.ok(colorRatchet.includes(f), `k3 五文件 ${f} 被全量扫描基线覆盖`);
  }
  assert.match(colorRatchet, /'App\.tsx': \d+/, 'App.tsx 在基线');
});
