// V4 复测评分卡 — 从现读门禁/判据机械派生，不用 canned 数字。
// Before = 11-11 基线（acceptance/ui-design-assessment-2026-11-11/ASSESSMENT-AND-PLAN.md）；
// After = 现读（V1/V2/V3/V4 收尾后）。纯读，无写副作用。
import fs from 'node:fs';
import path from 'node:path';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const has = (s, re) => re.test(s);

export function collectV234Scorecard(root) {
  const css = strip(fs.readFileSync(path.join(root, 'frontend/src/styles/custom.css'), 'utf8'));
  const contract = fs.readFileSync(path.join(root, 'frontend/src/styles/theme-token-contract.test.ts'), 'utf8');
  const global = fs.readFileSync(path.join(root, 'frontend/src/styles/global.css'), 'utf8');
  const pw = strip(fs.readFileSync(path.join(root, 'frontend/src/pages/project-workspace.module.css'), 'utf8'));

  const readings = {
    // A 质感标准：身份 token 亮暗双套 + 判据门禁在场
    identityTokensPaired: ['--petri-ink-paper', '--petri-ink-base', '--petri-accent-celadon', '--petri-accent-vermilion']
      .every((t) => (css.match(new RegExp(`${t}\\s*:`, 'g')) || []).length >= 2),
    ratchetGatePresent: has(contract, /只减不增|ratchet/),
    // B 配色：accent 收敛（c53 快照现读）+ 四档和声 + 骨架维度
    harmonyAccents: ['paper-vermilion', 'celadon-ink', 'ultramarine-brass', 'indigo-mist']
      .every((t) => has(css, new RegExp(`data-accent='${t}'`))),
    surfaceDimension: has(css, /\[data-surface\]/),
    // C 层级：leftPanelWrap 单定义 + 阴影三档 + selection 单源
    singlePanelWrap: (pw.match(/\.leftPanelWrap\s*\{/g) || []).length === 1,
    shadowTiers: ['--petri-shadow-menu', '--petri-shadow-float', '--petri-shadow-sm']
      .every((t) => has(css, new RegExp(`${t}\\s*:`))),
    selectionSingle: (global.match(/::selection\s*\{/g) || []).length === 1,
    // D 细节：双分号归零 + tabular + 对比度门禁 + 文案名词化
    noDoubleSemicolon: !has(pw, /;\s*;/),
    tabularNums: has(fs.readFileSync(path.join(root, 'frontend/src/pages/home.module.css'), 'utf8'), /font-variant-numeric:\s*tabular-nums/),
    contrastGate: has(fs.readFileSync(path.join(root, 'frontend/src/themes/SurfaceDimension.test.ts'), 'utf8'), /4\.5/),
    nounHeadings: !has(fs.readFileSync(path.join(root, 'frontend/src/components/desktop/DesktopSettingsPanel/sections/Federation.tsx'), 'utf8'), /<h4[^>]*>\s*添加/),
  };

  const dims = {
    A: [readings.identityTokensPaired, readings.ratchetGatePresent],
    B: [readings.harmonyAccents, readings.surfaceDimension],
    C: [readings.singlePanelWrap, readings.shadowTiers, readings.selectionSingle],
    D: [readings.noDoubleSemicolon, readings.tabularNums, readings.contrastGate, readings.nounHeadings],
  };
  // 诚实口径：11-11 before 是人工+静态混合评估；机械判据全过 ≠ 审美满分。
  // 每维最多 +0.5（保守下限估计），且 D 维本就 4.5 → 封顶 4.7（不宣称满分）。
  const before = { A: 3.0, B: 3.5, C: 3.5, D: 4.5, composite: 3.6 };
  const cap = { A: 0.5, B: 0.5, C: 0.5, D: 0.2 };
  const after = {};
  for (const [k, checks] of Object.entries(dims)) {
    const ratio = checks.filter(Boolean).length / checks.length;
// eslint-disable-next-line security/detect-object-injection -- 可信内部 JSON 读数面（canonical 契约/测试夹具，键为封闭词表或本地常量），启发式误报；R2 清偿批 S8 依 BLOCK-493 先例行级豁免留痕
    after[k] = Math.round((before[k] + ratio * cap[k]) * 10) / 10;
  }
  after.composite = Math.round((Object.values(after).reduce((a, b) => a + b, 0) / 4) * 10) / 10;

  return {
    kind: 'petri.ui-design.v234-scorecard.v1',
    method: '现读机械判据派生的保守下限估计（非人工审美打分）',
    before,
    after,
    readings,
    note: '机械判据全过只支撑每维 ≤+0.5 的保守增量，不等于审美满分；D 维封顶 4.7。' +
      'D 维 4.4 目标分为 U 类未采纳门槛；观感由 A4 预审单独签字，本分数不外推 E 类人眼槽/packaged/Provider/GA。',
  };
}
