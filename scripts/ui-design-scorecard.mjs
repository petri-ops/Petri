#!/usr/bin/env node
/**
 * UI-D5 (BLOCK-420) — Before/After 评分卡复评（可复跑）。
 *
 * 口径纪律（D0 冻结的尺子）：
 *  - 主表 Before = 报告 §0 的**专家静态评估分**；After = 同一专家静态口径，
 *    按当前源码锚点逐维复评。两列同尺可比，delta 才有意义。
 *  - 机械表 = 清单 v1 §5 归一化公式的**各指标当次读数**，作为复评依据，
 *    **不折算成分数**（该公式是为收敛量设计的，套到未优化态会全 0，与专家分不同尺）。
 *  - 静态分 ≠ 实机观感分；观感分只能由人测签字产生，Agent 不代答、不写 verified。
 *
 * 用法：node scripts/ui-design-scorecard.mjs  → 写 d5/before-after-scorecard.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const E = path.join(ROOT, 'acceptance/ui-design-assessment-2026-11-11');
const read = (p) => JSON.parse(fs.readFileSync(path.join(E, p), 'utf8'));
const baseline = read('baseline.json');
const d2 = read('d2/gate-readout.json');
const d4 = read('d4/gate-readout.json');

const round = (n) => Math.round(n * 10) / 10;

/** 主表：同套专家静态口径逐维复评（0–5，依据当前源码锚点，不虚高、不写 verified）。 */
const review = {
  A: {
    before: baseline.staticScores.layoutAndIA, after: 3.8,
    basis: '入口 canonical 单源（`gate:ui-entries` 16 路由 / 0 重复）、页头清单残留清零、断点常量单源与 767→768 对齐、布局定义唯一性门；扣分=17 档→≤4 档收敛属 U-04 待裁决、WIP 内 2 组既存重复布局定义零触碰',
    anchors: ['scripts/ui-design-entry-registry.mjs', 'scripts/ui-design-entry-gate.mjs', 'frontend/src/lib/uiBreakpoints.ts', 'scripts/ui-design-layout-gate.mjs'],
  },
  B: {
    before: baseline.staticScores.uxAndInteraction, after: 3.5,
    basis: '八态矩阵 32/32 有判据、focus 缺口只减棘轮、WCAG 对比度纯函数、9223 离屏实机（8/9 诚实判红）；**持平不虚高**：命令面板仍无可见 UI 按钮（IA-P2）、焦点环实机不可见未修、22 条人眼签字槽全空、树测试真人样本缺席',
    anchors: ['scripts/ui-design-a11y.mjs', 'docs/ui-design-human-eye-route.md', 'acceptance/ui-design-assessment-2026-11-11/d4/ui-d4-a11y-live-darwin.json'],
  },
  C: {
    before: baseline.staticScores.visualConsistency, after: 4.0,
    basis: 'hover 语义 1 真源、selected 专用 token 明暗成对、`--petri-surface-dim` 跨文件重复 0、非 WIP 424 处 `;;` 清零、裸 z 111→104、fallback 快照 19/235→17/190 下调；扣分=WIP 内 128 `;;`/26 裸 z/39 fallback 零触碰、3 处裸 z 因字节棘轮保留、暗色与 selected 观感 pending_human_eye',
    anchors: ['frontend/src/styles/custom.css', 'frontend/src/styles/global.css', 'frontend/src/styles/theme-token-contract.test.ts', 'scripts/ui-design-visual.mjs'],
  },
  D: {
    before: baseline.staticScores.engineeringStandards, after: 4.7,
    basis: 'D0 尺子 + 六期 6 个专项门 + `gate:ui-program` 汇总门 + 每门植入必红负测 + 五期 gate-readout 证据链 + `code-size` 合法下调；扣分=干净树 `closeout:full` 全门 PASS 因 W/V 红未达、人眼/裁决/凭据项未闭合',
    anchors: ['scripts/ui-design-program.mjs', 'test/ui-design-program.test.mjs', 'acceptance/ui-design-assessment-2026-11-11/d{0,1,2,3,4}/gate-readout.json'],
  },
};

/** 机械表：清单 v1 §5 各指标的当次读数（不折算成分数，避免口径混用）。 */
const mechanical = {
  scale: '清单 v1 §5 指标读数；仅作复评依据，不与专家静态分相加或换算',
  A: {
    canonicalPathsPerFunction: 1, duplicateCanonicalPaths: 0,
    orphanPages: '0 或显式 cancelled 留因（U-01）',
    layoutDefinitionSitesNonWip: 1, wipDuplicateGroups: 2,
    nonWipBreakpointTiers: d2.gates['gate:ui-breakpoints'].nonWipThresholds,
    registeredTiers: d2.gates['gate:ui-breakpoints'].registeredThresholds,
    jsBareThresholds: 0, jsCssAlignment: '767→768',
  },
  B: {
    eightStateCells: d4.gates['gate:ui-a11y'].matrixCells, blankCells: 0,
    focusGapFiles: d4.gates['gate:ui-a11y'].focusGapFiles,
    focusGapDeclarations: d4.gates['gate:ui-a11y'].focusGapDeclarations,
    outlineNoneTotal: 39, coreTaskClicks: '≤3（门断言）',
    paletteVisibleButton: false, humanEyeSignedRate: 0,
  },
  C: {
    hoverRootCount: 1, selectedTokens: 3, crossFileDuplicateDefinitions: 0,
    numericZBefore: 111, numericZAfter: 104,
    doubleSemisNonWip: 0, doubleSemisWipUntouched: 128,
    fallbackSnapshotBefore: '19 files / 235', fallbackSnapshotAfter: '17 files / 190',
    zRatchetBefore: '38 files / 111', zRatchetAfter: '34 files / 104',
  },
  D: {
    tokenContractTests: 19, gatesWithNegativeTests: 6,
    programGate: '6/6', programGateNegativeTests: 5,
    closeoutRuns: { D0: '19/19 PASS', D1: '19/19 PASS', D2: '21/21 PASS', D3: '23/23 PASS', D4: '24/24 PASS' },
    excludedWVgates: 4,
  },
};

const before = { A: review.A.before, B: review.B.before, C: review.C.before, D: review.D.before, composite: baseline.staticScores.composite };
const after = { A: review.A.after, B: review.B.after, C: review.C.after, D: review.D.after };
after.composite = round((after.A + after.B + after.C + after.D) / 4);
const delta = Object.fromEntries(['A', 'B', 'C', 'D'].map((k) => {
  const a = Object.getOwnPropertyDescriptor(after, k)?.value;
  const b = Object.getOwnPropertyDescriptor(before, k)?.value;
  return [k, round(a - b)];
}));
delta.composite = round(after.composite - before.composite);

const out = {
  schema: 'petri.ui-design.before-after-scorecard.v1',
  capturedAt: '2026-11-11',
  scoreType: '专家静态评估分（0–5）；同套口径同组证据；**静态分 ≠ 实机观感分，不写 verified**',
  scorecardSource: 'acceptance/ui-design-assessment-2026-11-11/ASSESSMENT-AND-PLAN.md §0 评分卡',
  formulaSource: 'docs/ui-design-acceptance-checklist-v1.md §5（机械指标口径）',
  before, after, delta, review, mechanical,
  selfCorrection: '初版把清单 §5 归一化公式的 After 值与报告的专家静态 Before 直接相减，得出 B 维 −0.9 的假下降（公式里人眼签字恒 0、命令面板无可见入口，与专家分不同尺）。已改为主表同套专家静态口径、机械表单列不折算，两不混用。',
  honestBoundaries: [
    'After 是 Agent 依据当前源码锚点与当次门读数的**静态复评分**，不是实机观感分，不写 verified、不宣称达标',
    '观感维度（暗色 hover / selected / 对比度 / 读屏 / 焦点环）签字槽全空 ⇒ B 维持平不虚高，观感分只能由人测签字产生',
    '报告 §4.1 的 A/B/C/D ≥4.4 出口阈值属 U-02 `pending_user_ruling`，本表不做达标宣称',
    'A/C 维因他方 WIP CSS 零触碰与 U-04 未裁决扣分，见 gap-ledger 逐件终态',
    'D 维的 closeout 数字是各期实际跑过的门；被 --skip 排除的 4 门 W/V 红未通过，不计入分子分母，另在 closeout-runs 如实登记',
  ],
  g0Note: 'G0 开发期常态 · 不外推 packaged/Provider/GA',
};
fs.writeFileSync(path.join(E, 'd5/before-after-scorecard.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify({ before, after, delta, note: '静态复评分，非观感分；机械读数见 JSON.mechanical' }, null, 2));
