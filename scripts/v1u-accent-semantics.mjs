// V1-U 语义收敛 codemod（白名单·幂等·只呈现面）。
// 规则：hover/active 里的 `color: var(--petri-accent)` → 中性 text；
// 若该规则原本没有其它反馈通道（bg/border/underline/shadow），补 `background: var(--petri-hover)` 保住反馈。
// 绝不触碰：focus 环、主按钮底、链接、状态色、data-* 语义态。
// dry 模式只打印 diff。

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('frontend/src');
const DRY = process.argv.includes('--dry');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(d, e.name);
  return e.isDirectory() ? walk(p) : p.endsWith('.css') ? [p] : [];
});
const accentText = /(?:^|;)\s*color:\s*var\(--petri-accent\)(?!-)/;
const feedback = /(?:^|;)\s*background\s*:|border[^:]*:[^;]*var\(|text-decoration:|box-shadow:/;
const semanticSel = /focus|\[aria-selected|\[aria-pressed|:checked|data-tone|data-state|is-selected|--petri-accent-bg/i;
const hoverActive = /:hover|Active|active/;
const changes = [];

for (const file of walk(ROOT)) {
  const original = fs.readFileSync(file, 'utf8');
  const text = original.replace(/([^{}]+)(\{)([^{}]*)(\})/g, (whole, selRaw, open, body, close) => {
    const sel = selRaw.trim().split('\n').pop().trim();
    if (semanticSel.test(sel) || !hoverActive.test(sel) || !accentText.test(body)) return whole;
    let b = body.replace(/(^|;)\s*color:\s*var\(--petri-accent\)(?!-)/g, '$1 color: var(--petri-text)');
    if (!feedback.test(b)) b = b.replace(/(\{?\s*)(color:\s*var\(--petri-text\))/, (_m, lead, decl) => `${lead}background: var(--petri-hover);\n    ${decl}`);
    if (b !== body) {
      changes.push({ file: path.relative(ROOT, file), sel: sel.slice(0, 70), addedBg: !feedback.test(body), before: body.trim().slice(0, 110), after: b.trim().slice(0, 140) });
      return selRaw + open + b + close;
    }
    return whole;
  });
  if (text !== original && !DRY) fs.writeFileSync(file, text);
}
const count = () => walk(ROOT).reduce((n, f) => n + (fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').match(/var\(--petri-accent\)/g) || []).length, 0);
if (!DRY) {
  fs.mkdirSync(path.resolve('acceptance/v1u-accent-semantics'), { recursive: true });
  fs.writeFileSync('acceptance/v1u-accent-semantics/converted.json',
    JSON.stringify({ kind: 'v1u-converted-rules', rules: changes.map((c) => ({ file: c.file, sel: c.sel, addedBg: c.addedBg })) }, null, 2) + '\n');
}
console.log(`changes=${changes.length} addedBg=${changes.filter((c) => c.addedBg).length} accentAfter=${count()} dry=${DRY}`);
for (const c of changes.slice(0, 45)) console.log(`${c.file} :: ${c.sel}${c.addedBg ? ' [+hover-bg]' : ''}\n  - ${c.before}\n  + ${c.after}`);
if (changes.length > 45) console.log(`… +${changes.length - 45} more`);
