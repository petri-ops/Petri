#!/usr/bin/env node
/**
 * scripts/c52-assistant-ui-pattern.mjs — BLOCK-478 / C-52 P2（余项首发）模式借鉴契约冻结扫描。
 *
 * collectAssistantUiPattern(root) 是纯函数：从 canonical 真源机械复算六组读数，不写产品代码、
 * 不依赖时间语义部分。C-52 P2 只做 assistant-ui 五种交互形态的「模式借鉴 + 契约冻结」——
 * Petri 已有本地主权形态锚点，不替换 SimpleChat、不新增产品依赖、观感 pending_human_eye 零代签。
 *   - streamingMessages  流式消息（referencesStreaming 投影 + references JSON 前缀判据 + M55 SSE 续传）
 *   - toolApproval       工具调用确认（ApprovalCard / GuardAckCard / PlanApprovalCard + 两个 hook）
 *   - attachments        附件（大小上限 / 校验 / 工作区落盘 / 拖放粘贴）
 *   - structuredData     结构化数据（::compose 五 kind + fail-closed + $state 安全引用 + 零依赖校验器）
 *   - optionLists        选项列表（AskUserQuestion 结构化提问 + 多选/自由输入 + answered/timedOut 诚实回传）
 *   - boundaries         边界（零新增依赖 / SimpleChat 未被替换 / 许可证来源登记 / 观感零代签）
 * 同一批读数派生 acceptance 快照与 resources/design-context/assistant-ui-pattern.json
 * ——模型可读、可复算，被 test/c52-assistant-ui-pattern.test.mjs 锚定。
 *
 * 用法：node scripts/c52-assistant-ui-pattern.mjs            # 写快照+契约+manifest
 *       node scripts/c52-assistant-ui-pattern.mjs --check    # 只重算并与落盘 value 比对
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 冻结读数 = 设计不变量，被消费测试逐读数深等。 */
export const READING_IDS = Object.freeze([
  'streamingMessages', 'toolApproval', 'attachments',
  'structuredData', 'optionLists', 'boundaries',
]);

/** 冻结下限（只减必红）：现读 it/测试数、kind 数、许可证来源数。 */
export const PATTERN_FLOOR = Object.freeze({
  streamingContractIts: 8,
  sseContractTests: 6,
  attachmentContractIts: 10,
  structuredContractIts: 10,
  optionContractIts: 3,
  composeKinds: 5,
  licenseSources: 4,
  owner: 'BLOCK-478 / C-52 P2：立项现读 2026-11-18；模式借鉴+契约冻结；零依赖/不替换 SimpleChat/观感零代签',
});

/** 许可证与来源登记（只记录、不引入依赖、不复制品牌资产）。 */
export const LICENSE_REGISTER = Object.freeze({
  'assistant-ui': 'MIT · 仅形态借鉴（流式消息/工具确认/附件/结构化数据/选项列表），不引入运行时依赖、不复制代码',
  'React Bits': 'MIT + Commons Clause · 仅反馈型微动效模式观察（P3 候选），保留版权、禁整页动效、禁转售组件本身',
  '21st.dev': '逐组件查许可 · 仅组件/模板片段灵感（P4 候选），防风格漂移与依赖膨胀',
  'Pinterest/Refero/CTA/Footer': '灵感画板与结构化评审法（P5 候选），仅评审素材不进产品',
});

// own-enumerable 查找（BLOCK-456 先例），避免 object-injection 告警。
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];
const readText = (rel, root = ROOT) => fs.readFileSync(path.join(root, rel), 'utf8');
const has = (text, re) => re.test(String(text ?? ''));
const count = (text, re) => (String(text ?? '').match(re) || []).length;

/** 纯函数：流式消息形态（sourcesOverride 为 {rel:text} 映射，测试注入用）。 */
export function scanStreamingMessages(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const streaming = read('frontend/src/components/copilot/gen-ui/referencesStreaming.ts');
  const projection = read('frontend/src/components/copilot/gen-ui/references.ts');
  const contract = read('frontend/src/components/copilot/gen-ui/references-streaming.test.ts');
  const sse = read('test/m4-sse-real-endpoint.test.mjs');
  return {
    streamingForcesPending: has(streaming, /if\s*\(\s*!?streaming\s*\)/) && has(streaming, /kind:\s*['"]pending['"]/),
    composeToPending: has(streaming, /compose\s*\?\s*\{?\s*kind:\s*['"]pending['"]/) || has(streaming, /part\.kind\s*===\s*['"]compose['"][\s\S]{0,120}kind:\s*['"]pending['"]/),
    completedUpgrade: has(streaming, /projectGenUiReferences\(content,\s*true\)/),
    jsonPrefixGuard: has(projection, /isComposeJsonPrefix/),
    sseResume: has(sse, /afterSeq/) && has(sse, /\[DONE\]/) && has(sse, /ping/),
    streamingContractIts: count(contract, /\bit\s*\(/g),
    sseContractTests: count(sse, /\b(?:it|test)\s*\(/g),
  };
}

/** 纯函数：工具调用确认形态。 */
export function scanToolApproval(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const approval = read('frontend/src/components/copilot/SimpleChat/ApprovalCard.tsx');
  const guard = read('frontend/src/components/copilot/SimpleChat/GuardAckCard.tsx');
  const plan = read('frontend/src/components/copilot/SimpleChat/PlanApprovalCard.tsx');
  const flow = read('frontend/src/components/copilot/SimpleChat/hooks/useApprovalFlow.ts');
  const guardHook = read('frontend/src/components/copilot/SimpleChat/hooks/useGuardAck.ts');
  return {
    approvalCardApproveReject: has(approval, /onApprove/) && has(approval, /onReject/),
    guardAckVariants: has(guard, /dynamic_guard/) && has(guard, /user_rule/) && has(guard, /mcp_trust/),
    planApprovalThreeWay: has(plan, /execute-fresh/) && has(plan, /keep-planning/) && has(plan, /'execute'/),
    approvalFlowHook: has(flow, /function useApprovalFlow/) || has(flow, /useApprovalFlow\s*\(/),
    guardAckHook: has(guardHook, /useGuardAck\s*\(/) && has(guardHook, /handleGuardAck/),
  };
}

/** 纯函数：附件形态。 */
export function scanAttachments(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const attachments = read('frontend/src/components/copilot/SimpleChat/attachments.ts');
  const upload = read('frontend/src/components/copilot/SimpleChat/attachmentUpload.ts');
  const drop = read('frontend/src/components/copilot/SimpleChat/hooks/useComposerDrop.ts');
  const contract = read('frontend/src/components/copilot/SimpleChat/attachments.test.ts');
  return {
    sizeLimits: has(attachments, /MAX_ATTACHMENT_BYTES/) && has(attachments, /MAX_ATTACHMENTS/),
    sizeGuard: has(attachments, /validateAttachmentSize/),
    workspaceUpload: has(upload, /\.chat-attachments/) && has(upload, /uploadFileToWorkspace|uploadBytesToWorkspace/),
    dragDrop: has(drop, /onDragOver/) && has(drop, /onDrop/),
    attachmentContractIts: count(contract, /\bit\s*\(/g),
  };
}

/** 纯函数：结构化数据形态。 */
export function scanStructuredData(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const spec = read('frontend/src/components/copilot/gen-ui/compose/spec.ts');
  const contract = read('frontend/src/components/copilot/gen-ui/compose/spec.test.ts');
  const kindsLine = (spec.match(/COMPOSE_KINDS\s*=\s*\[([^\]]*)\]/) || [])[1] ?? '';
  return {
    composeKindCount: count(kindsLine, /['"][A-Za-z-]+['"]/g),
    failClosed: has(spec, /fail-closed/) && has(spec, /未知 kind/) && has(spec, /环/),
    stateRefs: has(spec, /\$state\./) && has(spec, /isSafeStateRef/) && has(spec, /原型/),
    zeroDepSchema: has(spec, /手写校验器/) && has(spec, /零依赖/),
    structuredContractIts: count(contract, /\bit\s*\(/g),
  };
}

/** 纯函数：选项列表形态。 */
export function scanOptionLists(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const card = read('frontend/src/components/copilot/SimpleChat/UserQuestionCard.tsx');
  const contract = read('frontend/src/components/copilot/SimpleChat/UserQuestionCard.test.tsx');
  return {
    structuredQuestion: has(card, /AskUserQuestion/) && has(card, /ask_user_question/),
    optionFields: has(card, /multiSelect/) && has(card, /allowFreeText/) && has(card, /UserQuestionOption/),
    busyGuard: has(card, /busy/),
    honestRouting: has(card, /answered/) && has(card, /timedOut/),
    optionContractIts: count(contract, /\bit\s*\(/g),
  };
}

/** 纯函数：边界（零依赖 / 不替换 SimpleChat / 观感零代签 / 许可证登记）。 */
export function scanBoundaries(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const rootPkg = read('package.json');
  const frontPkg = read('frontend/package.json');
  const simpleChat = read('frontend/src/components/copilot/SimpleChat.tsx');
  const depBlock = (t) => (String(t ?? '').match(/"(?:dependencies|devDependencies)"\s*:\s*\{([\s\S]*?)\}/g) || []).join('\n');
  const depText = `${depBlock(rootPkg)}\n${depBlock(frontPkg)}`;
  const noNewDependency = !has(depText, /assistant-ui/) && !has(depText, /react-bits/) && !has(depText, /21st/) && !has(depText, /framer-motion/);
  const ledger = read('docs/ui-productization-audit.md');
  const sections = new Map();
  for (const m of ledger.matchAll(/^## (UI-\d+):[^\n]*(?:\n(?!(?:## |# ))[^\n]*)*/gm)) sections.set(m[1], m[0]);
  const eyeIds = Object.freeze(['UI-706', 'UI-707', 'UI-709', 'UI-710']);
  let humanEyeZeroSign = true;
  for (const id of eyeIds) {
    const sec = sections.get(id) ?? '';
    const inProgress = has(sec, /in_progress/i);
    const pending = has(sec, /pending_human_eye/i);
    const verified = has(sec, /\*\*verified\*\*|→\s*\*\*verified\*\*|状态.{0,12}verified/i);
    if (!inProgress || !pending || verified) humanEyeZeroSign = false;
  }
  return {
    noNewDependency,
    simpleChatIntact: has(simpleChat, /export function SimpleChat\s*\(/),
    simpleChatNotReplaced: !has(simpleChat, /from\s*['"][^'"]*assistant-ui/) && !has(simpleChat, /require\(['"][^'"]*assistant-ui/),
    humanEyeZeroSign,
    licenseRegister: { ...LICENSE_REGISTER },
  };
}

/** 完整性校验：任一下限/不变量违约即 ok=false（篡改负测 fail-closed）。 */
export function validateAssistantUiPatternIntegrity(readings) {
  const issues = [];
  const get = (id) => ownGet(readings ?? {}, id)?.value;
  if (!READING_IDS.every((id) => ownGet(readings ?? {}, id))) {
    return { ok: false, issues: ['读数结构不完整'] };
  }
  const s = get('streamingMessages');
  if (!s || !s.streamingForcesPending || !s.composeToPending || !s.completedUpgrade
    || !s.jsonPrefixGuard || !s.sseResume
    || s.streamingContractIts < PATTERN_FLOOR.streamingContractIts
    || s.sseContractTests < PATTERN_FLOOR.sseContractTests) issues.push('streamingMessages 违约');
  const a = get('toolApproval');
  if (!a || !a.approvalCardApproveReject || !a.guardAckVariants || !a.planApprovalThreeWay
    || !a.approvalFlowHook || !a.guardAckHook) issues.push('toolApproval 违约');
  const at = get('attachments');
  if (!at || !at.sizeLimits || !at.sizeGuard || !at.workspaceUpload || !at.dragDrop
    || at.attachmentContractIts < PATTERN_FLOOR.attachmentContractIts) issues.push('attachments 违约');
  const sd = get('structuredData');
  if (!sd || sd.composeKindCount !== PATTERN_FLOOR.composeKinds || !sd.failClosed
    || !sd.stateRefs || !sd.zeroDepSchema
    || sd.structuredContractIts < PATTERN_FLOOR.structuredContractIts) issues.push('structuredData 违约');
  const ol = get('optionLists');
  if (!ol || !ol.structuredQuestion || !ol.optionFields || !ol.busyGuard || !ol.honestRouting
    || ol.optionContractIts < PATTERN_FLOOR.optionContractIts) issues.push('optionLists 违约');
  const b = get('boundaries');
  if (!b || !b.noNewDependency || !b.simpleChatIntact || !b.simpleChatNotReplaced
    || !b.humanEyeZeroSign
    || Object.keys(b.licenseRegister ?? {}).length !== PATTERN_FLOOR.licenseSources) issues.push('boundaries 违约');
  return { ok: issues.length === 0, issues };
}

/** 纯函数：六组读数汇总，每项带 source/command/capturedAt。违反不变量即抛。 */
export function collectAssistantUiPattern(root = ROOT) {
  const cmd = 'node scripts/c52-assistant-ui-pattern.mjs';
  const mk = (value, source) => ({ value, source, command: cmd, capturedAt: 'freeze-invariant' });
  const readings = {
    streamingMessages: mk(scanStreamingMessages(root), 'referencesStreaming.ts + references.ts + references-streaming.test.ts + m4-sse-real-endpoint.test.mjs'),
    toolApproval: mk(scanToolApproval(root), 'ApprovalCard + GuardAckCard + PlanApprovalCard + useApprovalFlow/useGuardAck'),
    attachments: mk(scanAttachments(root), 'attachments.ts + attachmentUpload.ts + useComposerDrop.ts + attachments.test.ts'),
    structuredData: mk(scanStructuredData(root), 'gen-ui/compose/spec.ts + spec.test.ts（BLOCK-461）'),
    optionLists: mk(scanOptionLists(root), 'UserQuestionCard.tsx + .test.tsx（BLOCK-244 C19）'),
    boundaries: mk(scanBoundaries(root), '根/前端 package.json + SimpleChat.tsx + UI 台账 + LICENSE_REGISTER'),
  };
  const check = validateAssistantUiPatternIntegrity(readings);
  if (!check.ok) throw new Error(`[c52:pattern] 读数不合格: ${check.issues.join('; ')}`);
  return readings;
}

const sourceCommitOf = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function main(argv) {
  const readings = collectAssistantUiPattern(ROOT);
  const check = validateAssistantUiPatternIntegrity(readings);
  if (!check.ok) {
    console.error(`[c52:pattern] 读数不合格，拒绝写盘: ${check.issues.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const sourceCommit = sourceCommitOf(ROOT);
  const snapPath = path.join(ROOT, 'acceptance/block478-c52-p2-assistant-ui/assistant-ui-pattern-snapshot.json');
  const contractPath = path.join(ROOT, 'resources/design-context/assistant-ui-pattern.json');
  const manifestPath = path.join(ROOT, 'resources/design-context/manifest.json');

  if (argv.includes('--check')) {
    if (!fs.existsSync(snapPath)) { console.error('[c52:pattern] 快照缺席，请先生成'); process.exitCode = 1; return; }
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    for (const id of READING_IDS) {
      try { deepStrictEqual(ownGet(readings, id).value, ownGet(snap.readings, id).value); }
      catch { console.error(`[c52:pattern] --check 漂移: ${id}`); process.exitCode = 1; return; }
    }
    console.log(JSON.stringify({ ok: true, sourceCommit, readingIds: READING_IDS }, null, 2));
    return;
  }

  const frozenReadings = Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id)]));
  const snapshot = {
    schemaVersion: 1,
    kind: 'c52-assistant-ui-pattern',
    capability: 'block478-c52-p2-assistant-ui',
    sourceCommit,
    platform: `${os.platform()}-${os.arch()}`,
    command: 'node scripts/c52-assistant-ui-pattern.mjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'mechanical-gate',
    verdict: 'measured',
    humanEyeEquivalent: false,
    note: '读数=机械不变量（冻结，消费测试逐读数深等）；仅模式借鉴+契约冻结，观感 pending_human_eye 不代签，零 UI 运行时写面。',
    readings: frozenReadings,
  };
  const contract = {
    schemaVersion: 1,
    id: 'petri-assistant-ui-pattern-contract',
    kind: 'model-readable-assistant-ui-pattern',
    generatedBy: 'node scripts/c52-assistant-ui-pattern.mjs',
    sourceCommit,
    generatedAt: new Date().toISOString(),
    derivedFrom: [
      'referencesStreaming.ts + references.ts + references-streaming.test.ts（流式消息投影）',
      'test/m4-sse-real-endpoint.test.mjs（M55 SSE 续传）',
      'ApprovalCard/GuardAckCard/PlanApprovalCard + useApprovalFlow/useGuardAck（工具调用确认）',
      'attachments/attachmentUpload/useComposerDrop（附件）',
      'gen-ui/compose/spec.ts + spec.test.ts（结构化数据）',
      'UserQuestionCard.tsx + .test.tsx（选项列表）',
    ],
    patterns: Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id).value])),
    boundaries: {
      humanEyeSigned: false,
      readOnly: true,
      simpleChatReplaced: false,
      newProductDependency: false,
      note: '五种交互形态只做本地主权形态借鉴与契约冻结，不替换 SimpleChat、不新增产品依赖；观感项 pending_human_eye 保持 in_progress，Agent 不代签。',
    },
  };

  const contractBuf = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  for (const p of [snapPath, contractPath, manifestPath]) fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(snapPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(contractPath, contractBuf);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const sha = createHash('sha256').update(contractBuf).digest('hex');
  const entry = files.find((f) => ownGet(f, 'path') === 'assistant-ui-pattern.json');
  if (entry) entry.sha256 = sha;
  else files.push({ path: 'assistant-ui-pattern.json', sha256: sha });
  manifest.files = files;
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    written: [snapPath, contractPath, manifestPath].map((p) => path.relative(ROOT, p)),
    sourceCommit,
    readingIds: READING_IDS,
    composeKinds: ownGet(readings, 'structuredData').value.composeKindCount,
    humanEyeZeroSign: ownGet(readings, 'boundaries').value.humanEyeZeroSign,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
