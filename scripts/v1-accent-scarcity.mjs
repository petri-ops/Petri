// V1 配色稀缺化 — 一次性收敛 codemod（谨慎白名单）。
// 只做三类无损转换：① accent-bg 底 + accent 字的双重强调 → 字色回中性；
// ② 非 focus 选择器的装饰性 accent glow（box-shadow）→ 中性 shadow token；
// ③ 通用图标面的 accent 字色 → 中性 secondary（交互态保留）。
// 绝不触碰：主按钮 / 激活选中 / 链接 / focus 环 / 状态语义。
// 幂等：重复运行不产生新变化；写回前打印每条 diff 供审计。

import fs from 'node:fs';
import path from 'node:path';

const CSS_ROOT = path.resolve('frontend/src');
const DRY = process.argv.includes('--dry');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : p.endsWith('.css') ? [p] : [];
});

const isSemantic = (sel) =>
  /Active|active|:hover|focus|\[data-status|\[aria-(?:pressed|selected)|data-tone|data-state|:checked/i.test(sel);

const changes = [];
for (const file of walk(CSS_ROOT)) {
  const original = fs.readFileSync(file, 'utf8');
  let text = original;
  // 按规则块处理（保留注释位置：只改 declaration 文本，不重排）。
  text = text.replace(/([^{}]+)(\{)([^{}]*)(\})/g, (whole, selRaw, open, body, close) => {
    const sel = selRaw.trim().split('\n').pop().trim();
    let b = body;

    // ① 双重强调：accent-bg 底已有选中信号，字色回中性（保留交互可见性）。
    if (/background[^;]*var\(--petri-accent-bg\)/.test(b)) {
      b = b.replace(/color:\s*var\(--petri-accent\);/g, 'color: var(--petri-text);');
    }

    // ② 装饰 glow：非 focus 选择器 + box-shadow 含 accent → 中性阴影 token。
    if (!/focus/i.test(sel)) {
      b = b.replace(/box-shadow:([^;]*?)var\(--petri-accent\)([^;]*?);/g,
        (_m, a, c) => `box-shadow:${a}var(--petri-text)${c};`);
    }

    // ③ 通用图标面（非交互态）accent 字色 → secondary。
    if (/(?:__icon|\.icon\b|Icon)/.test(sel) && !isSemantic(sel)) {
      b = b.replace(/color:\s*var\(--petri-accent\);/g, 'color: var(--petri-text-secondary);');
    }

    if (b !== body) {
      changes.push({ file: path.relative(CSS_ROOT, file), sel, before: body.trim().slice(0, 120), after: b.trim().slice(0, 120) });
      return selRaw + open + b + close;
    }
    return whole;
  });

  if (text !== original && !DRY) fs.writeFileSync(file, text);
}
const count = () => walk(CSS_ROOT).reduce((n, f) =>
  n + (fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').match(/var\(--petri-accent\)/g) || []).length, 0);

console.log(`changes=${changes.length} accentBefore=356 accentAfter=${count()} dry=${DRY}`);
for (const c of changes.slice(0, 40)) console.log(`${c.file} :: ${c.sel}\n  - ${c.before}\n  + ${c.after}`);
if (changes.length > 40) console.log(`… +${changes.length - 40} more`);
