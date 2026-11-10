#!/usr/bin/env node
/**
 * K3 体验面事实采集与裁决（纯函数 + 只读扫描，供篡改负测）。
 *
 * 四类不变量：
 *   ① 四事件投影链完整（映射 → agentTaskStream → onAgentStatus → statusMessage → Banner）；
 *   ② 布局单源（B-11）：内层 composes、外层基础定义唯一、resize handle 单定义；
 *   ③ 内联样式颜色/z-index 债：只减不增棘轮，逐文件冻结；
 *   ④ UI 台账 debt 35：22 人眼 / 1 外部 / 12 可机械判档，人眼项不得标 verified。
 *
 * 不读写用户数据、不发事件、不改产品 CSS；裁决器接收事实对象便于负测注入。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const FOUR_EVENT_CODES = Object.freeze([
  'compaction_failed', 'trim_skipped', 'provider_retry', 'stream_stall',
]);
export const INLINE_DEBT_FILES = Object.freeze([
  'frontend/src/components/copilot/ContextBudgetBar.tsx',
  'frontend/src/components/workspace-panels/OrchestrationGraph.tsx',
  'frontend/src/components/copilot/ChatArtifactCard.tsx',
  'frontend/src/components/desktop/PluginStorePanel.tsx',
  'frontend/src/App.tsx',
]);
export const DEBT_CEILING = Object.freeze({ liveMissing: 13, blocked: 22, total: 35 });

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGBA = /rgba?\([^)]*\)/g;
const INLINE_Z = /zIndex:\s*\d+/g;

/** 统计单个 .tsx 内联样式颜色/z-index 字面量（排除注释与测试文件）。 */
export function countInlineLiterals(text) {
  const stripped = String(text).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  return {
    color: (stripped.match(HEX) || []).length + (stripped.match(RGBA) || []).length,
    zIndex: (stripped.match(INLINE_Z) || []).length,
  };
}

export function collectExperienceTruth(root = ROOT) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

  // ① 四事件投影链
  const mapper = read('frontend/src/components/copilot/copilotClient/runHealthEvents.ts');
  const stream = read('frontend/src/components/copilot/copilotClient/agentTaskStream.ts');
  const store = read('frontend/src/components/copilot/conversationRunStore.ts');
  const banner = read('frontend/src/components/copilot/StreamReconnectBanner.tsx');
  const events = {
    codesDeclared: FOUR_EVENT_CODES.filter((c) => mapper.includes(`'${c}'`)),
    mapperCases: (mapper.match(/case '/g) || []).length,
    streamImportsMapper: /mapRunHealthEvent/.test(stream),
    streamCallsOnAgentStatus: /onAgentStatus\?\.\(/.test(stream),
    storeWritesStatusMessage: /statusMessage/.test(store),
    bannerConsumesStatus: /statusMessage|data-reconnect-phase/.test(banner),
    toastHistoryExists: /history: ToastItem\[\]|HISTORY_LIMIT/.test(read('frontend/src/components/common/ToastProvider.tsx')),
    toastHistoryHasFourEvents: FOUR_EVENT_CODES.some((c) => read('frontend/src/components/common/ToastProvider.tsx').includes(c)),
  };

  // ② 布局单源
  const css = read('frontend/src/pages/project-workspace.module.css');
  const center = read('frontend/src/components/workspace-panels/CenterPanel.tsx');
  const resizer = read('frontend/src/components/workspace-panels/FloatCardResizer.tsx');
  const layout = {
    innerComposes: /\.workspaceSessionInner\s*\{[^}]*composes:\s*workspaceSessionLayout/s.test(css),
    baseDefinitionCount: (css.match(/^\.workspaceSessionLayout\s*\{/gm) || []).length,
    innerOwnName: /workspaceSessionInner/.test(center),
    floatHandleDefinitions: (resizer.match(/export (function|const) FloatCardResizeHandle/g) || []).length,
    floatHandleMounts: (center.match(/<FloatCardResizeHandle/g) || []).length,
  };

  // ③ 内联样式债（逐文件冻结）
  const inlineDebt = {};
  for (const rel of INLINE_DEBT_FILES) {
    inlineDebt[rel] = countInlineLiterals(read(rel));
  }
  const cssBaseline = JSON.parse(read('acceptance/post-s7-2026-11-10/h10/color-baseline.json'));
  const inlineBaselineFile = JSON.parse(read('acceptance/post-h9-2026-11-10/k3/k3-inline-style-baseline.json'));
  const inlineBaseline = inlineBaselineFile.perFile || inlineBaselineFile;
  const debtTotal = Object.values(inlineDebt).reduce((n, v) => n + v.color + v.zIndex, 0);

  // ④ UI 台账分诊
  const triage = JSON.parse(read('acceptance/block-332/ui-ledger-triage.json'));
  const ledgerText = read('docs/ui-productization-audit.md');

  return {
    events, layout, inlineDebt, debtTotal,
    cssBaselineTotal: cssBaseline.total,
    cssBaselineFiles: Object.keys(cssBaseline.perFile || {}).length,
    inlineBaseline,
    triage: { counts: triage.counts, debt: triage.debt, sections: triage.sections, uniqueIds: triage.uniqueIds },
    // 逐行判断：签名行的冒号后必须有真人填写内容，或复选框被勾选（☑/✅/x）。
    // 不能用 \s*\S（会跨行吃到下一行的「日期：」造成假签字）。
    humanEyeRouteSigned: (() => {
      const lines = read('docs/post-s7-h7-human-eye-route.md').split('\n');
      // 「结论：」行是模板文字（verified ☐ / 不通过 ☐），不计签字；
      // 只有「确认人」或「日期」冒号后同行有填写、或复选框从 ☐ 变 ☑ 才算人已签字。
      const filled = lines.some((l) => /^(确认人|日期)：\s*\S/.test(l.trim()));
      const checked = lines.some((l) => /[☑✅]/.test(l));
      return filled || checked;
    })(),
    ledgerMechanicallyClassified: /22 人眼|12 可机械判档/.test(ledgerText),
  };
}

/** 逐文件棘轮：当前不得高于冻结基线；新增即红。 */
export function adjudicateInlineDebt(current, baseline) {
  const issues = [];
  for (const rel of INLINE_DEBT_FILES) {
    const cur = current[rel];
    const base = baseline[rel];
    if (!cur || !base) { issues.push(`${rel} 缺当前读数或冻结基线`); continue; }
    if (cur.color > base.color) issues.push(`${rel} 内联颜色字面量 ${cur.color} > 冻结 ${base.color}（新增即红）`);
    if (cur.zIndex > base.zIndex) issues.push(`${rel} 内联 zIndex ${cur.zIndex} > 冻结 ${base.zIndex}（新增即红）`);
  }
  return { ok: issues.length === 0, issues, verdict: issues.length === 0 ? 'inline-debt-non-increasing' : 'inline-debt-increased' };
}

/** 总裁决：四事件/布局/棘轮/debt 四类不变量。 */
export function adjudicateExperience(input) {
  const issues = [];
  const conclusions = {};
  // fail-closed：事实整体/局部缺席时判红，不允许 TypeError 逃逸成「未测即过」。
  const t = {
    events: { codesDeclared: [], mapperCases: 0 }, layout: {}, inlineDebt: {}, inlineBaseline: {},
    cssBaselineTotal: null, cssBaselineFiles: null,
    triage: { counts: {} },
    humanEyeRouteSigned: false, ledgerMechanicallyClassified: false,
    ...(input && typeof input === 'object' ? input : {}),
  };
  t.events = t.events && typeof t.events === 'object' ? t.events : {};
  t.layout = t.layout && typeof t.layout === 'object' ? t.layout : {};
  t.triage = t.triage && typeof t.triage === 'object' ? t.triage : { counts: {} };
  t.triage.counts = t.triage.counts && typeof t.triage.counts === 'object' ? t.triage.counts : {};

  let n = issues.length;
  if (!(t.events.codesDeclared.length === 4 && t.events.mapperCases >= 4)) issues.push('K-14: 四事件映射不全');
  if (!(t.events.streamImportsMapper && t.events.streamCallsOnAgentStatus)) issues.push('K-14: agentTaskStream 未把映射接到 onAgentStatus');
  if (!(t.events.storeWritesStatusMessage && t.events.bannerConsumesStatus)) issues.push('K-14: statusMessage → Banner 消费链断裂');
  conclusions['K-14'] = issues.length === n ? 'projection-chain-intact' : 'drift';

  n = issues.length;
  if (!(t.layout.innerComposes && t.layout.baseDefinitionCount === 1 && t.layout.innerOwnName)) issues.push('K-16: B-11 内层 composes 单源被回退');
  if (!(t.layout.floatHandleDefinitions === 1 && t.layout.floatHandleMounts === 2)) issues.push('K-16: resize handle 单定义双挂载被破坏');
  conclusions['K-16'] = issues.length === n ? 'single-source-intact' : 'drift';

  n = issues.length;
  const inline = adjudicateInlineDebt(t.inlineDebt, t.inlineBaseline);
  for (const i of inline.issues) issues.push(`K-17: ${i}`);
  if (!(t.cssBaselineTotal === 354 && t.cssBaselineFiles === 30)) issues.push('K-17: CSS 面 354/30 基线被改写');
  conclusions['K-17'] = issues.length === n ? 'debt-frozen' : 'drift';

  n = issues.length;
  const counts = t.triage.counts || {};
  if (!(t.triage.debt === 35 && counts['live-missing'] === 13 && counts.blocked === 22)) issues.push('K-15: debt 35 / 13 / 22 口径被改写');
  if (!t.ledgerMechanicallyClassified) issues.push('K-15: 台账缺 22 人眼 / 12 可机械判档分诊结论');
  if (t.humanEyeRouteSigned) issues.push('K-15: 人眼路线出现签字记录，需人工复核后由人确认（Agent 不得代签）');
  conclusions['K-15'] = issues.length === n ? 'pending_human_eye' : 'drift';

  return {
    ok: issues.length === 0, issues, conclusions,
    verdict: issues.length === 0 ? 'experience-invariants-verified-with-e-l-boundaries' : 'experience-drift',
  };
}

function main() {
  const truth = collectExperienceTruth();
  const verdict = adjudicateExperience(truth);
  console.log(JSON.stringify({ verdict, inlineDebt: truth.inlineDebt, debtTotal: truth.debtTotal }, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`[post-h9:k3] fail-closed: ${e.message}`); process.exitCode = 1; }
}
