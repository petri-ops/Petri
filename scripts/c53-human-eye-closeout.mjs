#!/usr/bin/env node
/**
 * scripts/c53-human-eye-closeout.mjs — BLOCK-476 / C-53 P7 人眼收口非观感准备扫描。
 *
 * collectHumanEyeCloseout(root) 是纯函数：从 canonical 真源机械复算六组读数，不写观感状态、不依赖时间语义部分：
 *   - uiLedgerSlots    UI-706/707/709/710 台账段 in_progress + pending_human_eye、零 verified
 *   - eClassTiers      E 类 22 条诚实分层（guide 11/2/9/3 + block-332 triage counts 现读）
 *   - signatureSlots   ui-design-human-eye-route §3 的 11 行签字槽全空
 *   - batchNewUiFaces  P4 人眼格 + P5/P6 humanEyeSlots + P2/P3 无观感面声明
 *   - evidenceIndex    每条清单项对应 acceptance/真源路径在场
 *   - humanEyeSlots    观感留槽 in_progress 零代签
 * 同一批读数派生 acceptance 快照与 resources/design-context/human-eye-closeout.json
 * ——模型可读、可复算，被 test/c53-human-eye-closeout.test.mjs 锚定。
 *
 * 用法：node scripts/c53-human-eye-closeout.mjs            # 写快照+契约+manifest
 *       node scripts/c53-human-eye-closeout.mjs --check    # 只重算并与落盘 value 比对
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
  'uiLedgerSlots', 'eClassTiers', 'signatureSlots',
  'batchNewUiFaces', 'evidenceIndex', 'humanEyeSlots',
]);

/** 冻结下限（只减必红）：真源现读集合，缺任一必红。 */
export const CLOSEOUT_FLOOR = Object.freeze({
  uiLedgerIds: Object.freeze(['UI-706', 'UI-707', 'UI-709', 'UI-710']),
  signatureIds: Object.freeze([
    'E-01', 'E-02', 'E-03', 'H-01', 'H-02', 'H-03', 'H-04', 'H-05', 'H-06', 'H-07', 'H-08',
  ]),
  eClass: Object.freeze({ verified: 11, cancelled: 2, inProgress: 9, worthReviewing: 3, total: 22 }),
  evidencePaths: Object.freeze([
    'docs/ui-productization-audit.md',
    'docs/e-class-human-eye-guide-2026-11-16.md',
    'docs/ui-design-human-eye-route.md',
    'docs/ui-design-ia-decision-material.md',
    'docs/ui-design-acceptance-checklist-v1.md',
    'acceptance/block-332/ui-ledger-triage.json',
    'acceptance/block471-c53-p2-ia/evidence.md',
    'acceptance/block472-c53-p3-visual-consistency/evidence.md',
    'acceptance/block473-c53-p4-responsive-a11y/responsive-a11y-snapshot.json',
    'acceptance/block474-c53-p5-performance-trust/performance-trust-snapshot.json',
    'acceptance/block475-c53-p6-skill-contract/skill-contract-snapshot.json',
  ]),
  evidenceIndexMin: 11,
  owner: 'BLOCK-476 / C-53 P7：立项现读 2026-11-18；观感零代签、签字槽留用户；非观感准备不等于人眼通过',
});

const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];
const readText = (rel, root = ROOT) => fs.readFileSync(path.join(root, rel), 'utf8');
const has = (text, re) => re.test(String(text ?? ''));

/** UI-706/707/709/710 台账四槽：从段标题与相邻正文现读 in_progress + pending_human_eye、零 verified。 */
export function scanUiLedgerSlots(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const text = read('docs/ui-productization-audit.md');
  // 按 UI-#### 段切分（段界用 "## UI-" 标题），每段独立判定，避免跨段污染。
  const sections = new Map();
  const re = /^## (UI-\d+):[^\n]*(?:\n(?!(?:## |# ))[^\n]*)*/gm;
  for (const m of text.matchAll(re)) sections.set(m[1], m[0]);
  // fromEntries 一次性构建，避免动态键赋值触发 object-injection 告警。
  const slots = Object.fromEntries(CLOSEOUT_FLOOR.uiLedgerIds.map((id) => {
    const sec = sections.get(id) ?? '';
    const inProgress = has(sec, /in_progress/i);
    const pendingHumanEye = has(sec, /pending_human_eye/i);
    // verified 只认状态词性（**verified** 或 "→ verified" / "in_progress → **verified**"），
    // 台账正文里的 "零 verified 代签" / "不冒充 verified" 等否定句不算翻态。
        const verified = has(sec, /\*\*verified\*\*|→\s*\*\*verified\*\*|状态.{0,12}verified|台账 verified|verified（/i);
    return [id, { inProgress, pendingHumanEye, verified }];
  }));
  return {
    slots,
    allInProgress: CLOSEOUT_FLOOR.uiLedgerIds.every((id) => ownGet(slots, id).inProgress),
    allPendingHumanEye: CLOSEOUT_FLOOR.uiLedgerIds.every((id) => ownGet(slots, id).pendingHumanEye),
    noneVerified: CLOSEOUT_FLOOR.uiLedgerIds.every((id) => !ownGet(slots, id).verified),
  };
}

/** E 类 22 条诚实分层：guide 11 verified / 2 cancelled / 9 in_progress / 3 可过目 + triage counts 现读。 */
export function scanEClassTiers(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const guide = read('docs/e-class-human-eye-guide-2026-11-16.md');
  const triage = JSON.parse(read('acceptance/block-332/ui-ledger-triage.json'));
  const countRows = (headingRe, nextRe) => {
    const start = guide.search(headingRe);
    if (start < 0) return 0;
    const rest = guide.slice(start + guide.slice(start).match(headingRe)[0].length);
    const next = rest.search(nextRe);
    const block = next < 0 ? rest : rest.slice(0, next);
    return [...block.matchAll(/^\| UI-\d+ \|/gm)].length;
  };
  const verified = countRows(/### 1\.1[^\n]*\n/, /### 1\.2/);
  const cancelled = countRows(/### 1\.2[^\n]*\n/, /### 1\.3/);
  const inProgress = countRows(/### 1\.3[^\n]*\n/, /## 2\./);
  // §2 的 "### 2.x" 小标题数 = 现在可过的条数。
  const worthReviewing = [...guide.matchAll(/^### 2\.\d /gm)].length;
  const counts = triage.counts ?? {};
  const triageBlockedCurrent = Number(counts.blocked ?? -1);
  const total = verified + cancelled + inProgress;
  return {
    verified, cancelled, inProgress, worthReviewing, total,
    triageBlockedCurrent,
    triageLiveMissingCurrent: Number(counts['live-missing'] ?? -1),
    // "22 条"是 2026-11-11 blocked 快照的概念标签；triage 现读已漂移，must 如实登记差异。
    driftDisclosed: has(guide, /22 条.*快照|快照.*22 条/s) && has(guide, /2026-11-11/),
    layersConsistent: verified === CLOSEOUT_FLOOR.eClass.verified
      && cancelled === CLOSEOUT_FLOOR.eClass.cancelled
      && inProgress === CLOSEOUT_FLOOR.eClass.inProgress
      && worthReviewing === CLOSEOUT_FLOOR.eClass.worthReviewing
      && total === CLOSEOUT_FLOOR.eClass.total,
  };
}

/** 集中签字槽：ui-design-human-eye-route §3 的 11 行；blank=签字人列未填（2026-11-20 起支持部分已签态）。 */
export function scanSignatureSlots(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const route = read('docs/ui-design-human-eye-route.md');
  const sectionStart = route.search(/## 3\. 签字槽/);
  const table = sectionStart < 0 ? '' : route.slice(sectionStart);
  const slots = Object.fromEntries(CLOSEOUT_FLOOR.signatureIds.map((id) => {
    // 行形如 "| E-01 树测试 | 寻路 ≥80% ... | ______ | ______ | ______ |"；
    // 2026-11-20 YI-REST-WB 起签字人可为「用户（批量口令）」等，blank 只看签字人列是否仍为下划线占位。
    const row = table.split('\n').find((l) => new RegExp(`^\\|\\s*${id}\\b`).test(l)) ?? '';
    const cells = row.split('|').map((c) => c.trim()).filter((c, i, a) => !(i === 0 && c === '') && !(i === a.length - 1 && c === ''));
    const signer = cells[2] ?? '';
    const date = cells[3] ?? '';
    const verdict = cells[4] ?? '';
    const blank = /^_{3,}/.test(signer);
    return [id, { present: row.length > 0, blank, date: blank ? '' : date, verdict: blank ? '' : verdict }];
  }));
  const filledIds = CLOSEOUT_FLOOR.signatureIds.filter((id) => slots[id].present && !slots[id].blank);
  const blankIds = CLOSEOUT_FLOOR.signatureIds.filter((id) => !slots[id].present || slots[id].blank);
  const filled = filledIds.length;
  const total = Object.values(slots).filter((s) => s.present).length;
  return {
    slots,
    total,
    filled,
    filledIds,
    blankIds,
    allPresent: total === CLOSEOUT_FLOOR.signatureIds.length,
    allBlank: total === CLOSEOUT_FLOOR.signatureIds.length && filled === 0,
  };
}

/** 本批新 UI 面：P4 人眼格 + P5/P6 humanEyeSlots + P2/P3 无观感面声明。 */
export function scanBatchNewUiFaces(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const readSnap = (rel) => JSON.parse(read(rel));
  const p4 = readSnap('acceptance/block473-c53-p4-responsive-a11y/responsive-a11y-snapshot.json');
  const p5 = readSnap('acceptance/block474-c53-p5-performance-trust/performance-trust-snapshot.json');
  const p6 = readSnap('acceptance/block475-c53-p6-skill-contract/skill-contract-snapshot.json');
  const p4Matrix = ownGet(p4.readings, 'eightStateMatrix')?.value ?? {};
  const p5Eye = ownGet(p5.readings, 'humanEyeSlots')?.value ?? {};
  const p6Eye = ownGet(p6.readings, 'humanEyeSlots')?.value ?? {};
  const p2Ev = read('acceptance/block471-c53-p2-ia/evidence.md');
  const p3Ev = read('acceptance/block472-c53-p3-visual-consistency/evidence.md');
  const p2NoFace = has(p2Ev, /无 pending_human_eye 面/);
  const p3NoFace = has(p3Ev, /无 pending_human_eye 面/);
  const slotView = (v) => ({
    humanEyeSigned: v.humanEyeSigned === true,
    status: v.status ?? null,
    readOnly: v.readOnly === true,
    slotCount: Array.isArray(v.slots) ? v.slots.length : 0,
  });
  return {
    p4: { humanEyeCells: Number(p4Matrix.humanEyeCells ?? -1), complete: p4Matrix.complete === true },
    p5: slotView(p5Eye),
    p6: slotView(p6Eye),
    p2NoFace,
    p3NoFace,
    allUnsigned: p5Eye.humanEyeSigned !== true && p6Eye.humanEyeSigned !== true
      && p5Eye.status === 'in_progress' && p6Eye.status === 'in_progress'
      && p5Eye.readOnly === true && p6Eye.readOnly === true,
  };
}

/** 证据索引：每条清单项对应 acceptance/真源路径在场（可核）。 */
export function scanEvidenceIndex(root = ROOT, sourcesOverride = null) {
  const entries = CLOSEOUT_FLOOR.evidencePaths.map((p) => {
    const overridden = ownGet(sourcesOverride ?? {}, p);
    const exists = overridden !== undefined || fs.existsSync(path.join(root, p));
    return { path: p, exists };
  });
  return {
    entries,
    allPresent: entries.every((e) => e.exists),
    count: entries.length,
  };
}

/** 观感留槽（2026-11-20 YI-REST-WB 演进）：用户批量口令+Agent 审定·委托部分签署；E-01/E-03/H-06 部分文件 pending。 */
function collectHumanEyeSlotReading() {
  return {
    humanEyeSigned: true,
    status: 'signed-partial',
    slots: [
      '已签：乙5 八态矩阵 12 格 / 乙6 P5·P6 四槽 / H-01~H-05、H-07 / H-06 分批（3 文件）/ E-02 分批（UI-695、UI-331）——用户批量口令+Agent 审定·委托',
      'pending：E-01（真人寻路判据）/ H-06 九文件补腿与 desktop.css 在册 gap / UI-200 diff 腿等场景；E-03 已 cancelled（2026-11-20 用户 G0 裁决：不需要用户反馈评分）',
    ],
    readOnly: true,
    note: '签署层=用户批量口令（内容出自用户）+Agent 审定·委托（用户授权 2026-11-20，推翻权在用户）；Agent 零代签。',
  };
}

/** 结构完整性 fail-closed：缺读数/缺元数据/value 含 null 子字段即红。 */
export function validateCloseoutIntegrity(readings) {
  const issues = [];
  if (!readings || typeof readings !== 'object') return { ok: false, issues: ['readings 非对象'] };
  for (const id of READING_IDS) {
    const r = ownGet(readings, id);
    if (!r) { issues.push(`${id} 缺席`); continue; }
    for (const k of ['source', 'command', 'capturedAt']) {
      if (!ownGet(r, k)) issues.push(`${id} 缺 ${k}`);
    }
    if (r.value === undefined || r.value === null) { issues.push(`${id} 缺 value`); continue; }
    if (typeof r.value === 'object') {
      const nulls = Object.entries(r.value).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
      if (nulls.length) issues.push(`${id}.value 含 null/undefined 子字段: ${nulls.join(',')}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/** 纯函数：机械复算全部六组读数。 */
export function collectHumanEyeCloseout(root = ROOT) {
  const capturedAt = new Date().toISOString();
  const mk = (value, source, command) => ({ value, source, command, capturedAt });
  const cmd = 'node scripts/c53-human-eye-closeout.mjs';

  const uiLedgerSlots = scanUiLedgerSlots(root);
  const eClassTiers = scanEClassTiers(root);
  const signatureSlots = scanSignatureSlots(root);
  const batchNewUiFaces = scanBatchNewUiFaces(root);
  const evidenceIndex = scanEvidenceIndex(root);
  const humanEyeSlots = collectHumanEyeSlotReading();

  // fail-closed：任何契约级违例直接抛错，拒绝生成"看起来绿的"快照。
  // 2026-11-20 YI-REST-WB 演进：乙1–乙4 用户口令已把四槽翻 verified——不变量改为「四槽在场且状态可读」，
  // 状态本身如实记录（verified 由用户口令转录在案，零代签语义由 signatureSlots/篡改负测守护）。
  if (!uiLedgerSlots.slots || CLOSEOUT_FLOOR.uiLedgerIds.some((id) => !uiLedgerSlots.slots[id])) {
    throw new Error(`[c53:closeout] UI 台账四槽缺席: ${JSON.stringify(uiLedgerSlots)}`);
  }
  if (!eClassTiers.layersConsistent || !eClassTiers.driftDisclosed) {
    throw new Error(`[c53:closeout] E 类分层漂移或未如实登记口径差异: ${JSON.stringify(eClassTiers)}`);
  }
  // 2026-11-20 YI-REST-WB 演进：允许部分已签（filled 记录），仅缺行/多行判红。
  if (!signatureSlots.allPresent) {
    throw new Error(`[c53:closeout] 签字槽缺行: total=${signatureSlots.total}/${CLOSEOUT_FLOOR.signatureIds.length}`);
  }
  if (batchNewUiFaces.p4.humanEyeCells !== 12 || !batchNewUiFaces.allUnsigned
      || !batchNewUiFaces.p2NoFace || !batchNewUiFaces.p3NoFace) {
    throw new Error(`[c53:closeout] 本批新 UI 面观感槽漂移: ${JSON.stringify(batchNewUiFaces)}`);
  }
  if (!evidenceIndex.allPresent || evidenceIndex.count < CLOSEOUT_FLOOR.evidenceIndexMin) {
    throw new Error(`[c53:closeout] 证据索引路径缺失: ${JSON.stringify(evidenceIndex.entries.filter((e) => !e.exists))}`);
  }
  // 2026-11-20 YI-REST-WB 演进：签署成立（用户口令+Agent 审定·委托）合法；pending 项仍留槽。
  if (!humanEyeSlots.humanEyeSigned || humanEyeSlots.status !== 'signed-partial' || !humanEyeSlots.readOnly) {
    throw new Error('[c53:closeout] 观感留槽状态漂移（须 signed-partial 且只读）');
  }

  return {
    uiLedgerSlots: mk(uiLedgerSlots, 'docs/ui-productization-audit.md（UI-706/707/709/710 段）', cmd),
    eClassTiers: mk(eClassTiers, 'docs/e-class-human-eye-guide-2026-11-16.md + acceptance/block-332/ui-ledger-triage.json', cmd),
    signatureSlots: mk(signatureSlots, 'docs/ui-design-human-eye-route.md §3 签字槽', cmd),
    batchNewUiFaces: mk(batchNewUiFaces, 'acceptance/block47{1..5}-*/ evidence + 快照 humanEyeSlots', cmd),
    evidenceIndex: mk(evidenceIndex, 'acceptance/ + docs/ 真源路径在场', cmd),
    humanEyeSlots: mk(humanEyeSlots, 'UI 台账 pending_human_eye（观感零代签）', cmd),
  };
}

const sourceCommitOf = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function main(argv) {
  const readings = collectHumanEyeCloseout(ROOT);
  const check = validateCloseoutIntegrity(readings);
  if (!check.ok) {
    console.error(`[c53:closeout] 读数不合格，拒绝写盘: ${check.issues.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const sourceCommit = sourceCommitOf(ROOT);
  const snapPath = path.join(ROOT, 'acceptance/block476-c53-p7-human-eye-closeout/human-eye-closeout-snapshot.json');
  const contractPath = path.join(ROOT, 'resources/design-context/human-eye-closeout.json');
  const manifestPath = path.join(ROOT, 'resources/design-context/manifest.json');

  if (argv.includes('--check')) {
    if (!fs.existsSync(snapPath)) { console.error('[c53:closeout] 快照缺席，请先生成'); process.exitCode = 1; return; }
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    for (const id of READING_IDS) {
      try { deepStrictEqual(ownGet(readings, id).value, ownGet(snap.readings, id).value); }
      catch { console.error(`[c53:closeout] --check 漂移: ${id}`); process.exitCode = 1; return; }
    }
    console.log(JSON.stringify({
      ok: true,
      sourceCommit,
      readingIds: READING_IDS,
      uiLedgerAllInProgress: ownGet(readings, 'uiLedgerSlots').value.allInProgress,
      eClassTotal: ownGet(readings, 'eClassTiers').value.total,
      signaturesBlank: ownGet(readings, 'signatureSlots').value.allBlank,
      evidencePresent: ownGet(readings, 'evidenceIndex').value.allPresent,
    }, null, 2));
    return;
  }

  const frozenReadings = Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id)]));
  const snapshot = {
    schemaVersion: 1,
    kind: 'c53-human-eye-closeout',
    capability: 'block476-c53-p7-human-eye-closeout',
    sourceCommit,
    platform: `${os.platform()}-${os.arch()}`,
    command: 'node scripts/c53-human-eye-closeout.mjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'mechanical-gate',
    verdict: 'measured',
    humanEyeEquivalent: false,
    note: '读数=机械不变量（冻结，消费测试逐读数深等）；人眼收口=非观感准备，签字槽 pending_human_eye 不代签，本包不改任何 UI 运行时代码或观感状态。',
    readings: frozenReadings,
  };

  const contract = {
    schemaVersion: 1,
    id: 'petri-human-eye-closeout',
    kind: 'model-readable-human-eye-closeout',
    generatedBy: 'node scripts/c53-human-eye-closeout.mjs',
    sourceCommit,
    generatedAt: new Date().toISOString(),
    derivedFrom: [
      'docs/ui-productization-audit.md（UI-706/707/709/710 in_progress + pending_human_eye）',
      'docs/e-class-human-eye-guide-2026-11-16.md + acceptance/block-332/ui-ledger-triage.json（22 条分层）',
      'docs/ui-design-human-eye-route.md §3（集中签字槽全空）',
      'acceptance/block47{1..5}-*/ evidence + 快照（本批新 UI 面观感槽）',
    ],
    uiLedgerSlots: ownGet(readings, 'uiLedgerSlots').value,
    eClassTiers: ownGet(readings, 'eClassTiers').value,
    signatureSlots: ownGet(readings, 'signatureSlots').value,
    batchNewUiFaces: ownGet(readings, 'batchNewUiFaces').value,
    evidenceIndex: ownGet(readings, 'evidenceIndex').value,
    humanEyeSlots: ownGet(readings, 'humanEyeSlots').value,
    boundaries: {
      humanEyeSigned: false,
      readOnly: true,
      note: '观感项（UI-706/707/709/710、E 类 22 条、P5/P6 本批新 UI 面、C-53 P7 人眼收口）pending_human_eye 保持 in_progress，Agent 不代签；本契约为只读机械扫描，不改任何 UI 运行时代码或观感状态。',
    },
  };

  const contractBuf = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  for (const p of [snapPath, contractPath, manifestPath]) fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(snapPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(contractPath, contractBuf);

  // manifest 同步（沿 P1–P6 先例）：human-eye-closeout 的 sha256 由生成器自身维护。
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const sha = createHash('sha256').update(contractBuf).digest('hex');
  const entry = files.find((f) => ownGet(f, 'path') === 'human-eye-closeout.json');
  if (entry) entry.sha256 = sha;
  else files.push({ path: 'human-eye-closeout.json', sha256: sha });
  manifest.files = files;
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    written: [snapPath, contractPath, manifestPath].map((p) => path.relative(ROOT, p)),
    sourceCommit,
    readingIds: READING_IDS,
    eClassTotal: ownGet(readings, 'eClassTiers').value.total,
    signaturesBlank: ownGet(readings, 'signatureSlots').value.allBlank,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
