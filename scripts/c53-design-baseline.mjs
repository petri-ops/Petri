#!/usr/bin/env node
/**
 * BLOCK-465 / C-53 S1 — 设计基线冻结 + 上下文包硬化的单一真源采集器。
 *
 * collectDesignBaseline(root) 是纯函数：从 canonical 源（design-charter.md /
 * theme-token-contract.test.ts / ui-ledger-triage.json / controls 目录 /
 * DOC-REGISTRY.json / AUDIT-LOG.md）机械复算，不写盘、不依赖时间。
 * 同一批读数派生 acceptance 快照与 resources/design-context 上下文包——
 * 单一真源，消费测试（test/c53-design-context-pack.test.mjs）锚定。
 *
 * 用法：node scripts/c53-design-baseline.mjs            # 写快照+包+manifest
 *       node scripts/c53-design-baseline.mjs --check    # 只重算并与落盘 value 比对
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 冻结读数 = 设计不变量（跨工作包生命周期稳定），被消费测试逐读数深等。
export const READING_IDS = Object.freeze([
  'fontTiers', 'colorBudget', 'borderSemantics', 'motion', 'controls',
  'ratchets', 'tokenGate', 'uiDebt', 'componentRules',
]);
// 捕获时状态上下文：随工作包开合而变，仅作"快照取自干净态"的留痕，不参与冻结比对。
export const CONTEXT_IDS = Object.freeze(['registry', 'auditUnresolved']);

const readText = (rel, root) => fs.readFileSync(path.join(root, rel), 'utf8');
const readJson = (rel, root) => JSON.parse(readText(rel, root));

const requireMatch = (re, src, label) => {
  const m = src.match(re);
  if (!m) throw new Error(`[c53-baseline] 真源解析失败: ${label}（契约漂移？）`);
  return m;
};

// 自有可枚举查找（BLOCK-456 object-injection 根因修先例）：键来自本模块冻结常量，
// 用 own-enumerable 查找避免原型链命中，语义等价且零 security/detect-object-injection 告警。
const ownGet = (obj, key) => Object.entries(obj).find(([k]) => k === key)?.[1];

/**
 * 纯函数：机械复算全部读数。返回 { [id]: {value, source, command, capturedAt} }。
 * capturedAt 仅元数据（调用时取一次），不参与消费测试的逐读数比对。
 */
export function collectDesignBaseline(root = ROOT) {
  const charter = readText('docs/design-charter.md', root);
  const tokenTest = readText('frontend/src/styles/theme-token-contract.test.ts', root);
  const triage = readJson('acceptance/block-332/ui-ledger-triage.json', root);
  const debtCeilingSrc = readText('scripts/lib/post-h9-k3-experience.mjs', root);
  const registry = readJson('docs/DOC-REGISTRY.json', root);
  const audit = readText('docs/AUDIT-LOG.md', root);
  const controlsDir = path.join(root, 'frontend/src/components/ui/controls');
  const capturedAt = new Date().toISOString();
  const mk = (value, source, command) => ({ value, source, command, capturedAt });

  // §1 字号 6 档
  const fontRows = [...charter.matchAll(/\|\s*`--petri-font-size-(2xl|xl|lg|body|sm|xs)`\s*\|\s*(\d+)px\s*\|/g)];
  if (fontRows.length !== 6) throw new Error(`[c53-baseline] 字号档应为 6，实得 ${fontRows.length}`);
  const fontTiers = {
    tiers: fontRows.map((m) => ({ token: `--petri-font-size-${m[1]}`, px: Number(m[2]) })),
    count: fontRows.length,
  };

  // §2 色彩预算
  const ratio = Number(requireMatch(/中性\s*:\s*强调引用比终态\s*\*\*≥(\d+):1\*\*/, charter, '色彩中性:强调比')[1]);
  const accentCeiling = Number(requireMatch(/引用总量终态\s*≤(\d+)/, charter, 'accent 引用上限')[1]);
  const accentsPerView = Number(requireMatch(/每视图可见强调点目标\s*≤(\d+)/, charter, '每视图强调点')[1]);
  const colorBudget = { neutralToAccentRatio: ratio, accentRefCeiling: accentCeiling, accentsPerView };

  // §3 线条三语义
  const borderTokens = [...charter.matchAll(/\|\s*`(--petri-(?:border-input|border-card|divider))`\s*\|/g)].map((m) => m[1]);
  if (borderTokens.length !== 3) throw new Error(`[c53-baseline] 线条语义应为 3，实得 ${borderTokens.length}`);
  const borderSemantics = { tokens: borderTokens, count: 3, noSemanticHairlineTarget: 0 };

  // §4 动效
  const dm = requireMatch(/`--petri-duration-fast\/base\/slow`\s*=\s*(\d+)\/(\d+)\/(\d+)ms/, charter, '动效 duration 三档');
  const motion = {
    durations: { fast: Number(dm[1]), base: Number(dm[2]), slow: Number(dm[3]) },
    easeTokens: ['--petri-ease-standard', '--petri-ease-emphasized'],
    easeCount: 2,
    durationCount: 3,
  };

  // §6 控件五件套 + 现读目录
  requireMatch(/Button\/Input\/Select\/Chip\/Empty\s*五件套/, charter, '控件五件套');
  const controls = {
    pieces: ['Button', 'Input', 'Select', 'Chip', 'Empty'],
    count: 5,
    sourceDirFiles: fs.existsSync(controlsDir) ? fs.readdirSync(controlsDir).sort() : [],
  };

  // §7 三条棘轮终态
  const ratchets = {
    smallFont: Number(requireMatch(/小字号棘轮（\d+→≤\d+→≤(\d+)）/, charter, '小字号棘轮终态')[1]),
    accent: Number(requireMatch(/accent 棘轮（\d+→≤\d+→≤(\d+)）/, charter, 'accent 棘轮终态')[1]),
    noSemanticBorder: Number(requireMatch(/无语义细线棘轮（\d+→≤\d+→(\d+)）/, charter, '无语义细线终态')[1]),
  };

  // theme-token-contract 断言组在场 + 计数
  const assertionCount = (tokenTest.match(/(?:^|\n)\s*it\(['"]/g) || []).length;
  const keyTitles = [
    'defines every Petri token referenced in frontend source',
    'small font usage holds the frozen ratchet',
    'accent usage holds the frozen ratchet',
    'non-semantic 1px borders hold zero tolerance',
    'charter counters catch synthetic violations',
  ];
  const tokenGate = {
    assertions: assertionCount,
    keyTitlesPresent: keyTitles.every((t) => tokenTest.includes(t)),
    keyTitles,
  };

  // UI 债 38 口径 + DEBT_CEILING 交叉一致
  const ceil = requireMatch(/DEBT_CEILING\s*=\s*Object\.freeze\(\{\s*liveMissing:\s*(\d+),\s*blocked:\s*(\d+),\s*total:\s*(\d+)/, debtCeilingSrc, 'DEBT_CEILING');
  const uiDebt = {
    sections: triage.sections,
    uniqueIds: triage.uniqueIds,
    debt: triage.debt,
    liveMissing: triage.counts?.['live-missing'] ?? null,
    blocked: triage.counts?.blocked ?? null,
    verified: triage.counts?.verified ?? null,
    closed: triage.counts?.closed ?? null,
    ceilingCrossCheck: { liveMissing: Number(ceil[1]), blocked: Number(ceil[2]), total: Number(ceil[3]) },
    consistent: triage.debt === Number(ceil[3])
      && triage.counts?.['live-missing'] === Number(ceil[1])
      && triage.counts?.blocked === Number(ceil[2]),
  };

  // 组件规则（宪章 §6 单源 + 现读 controls 文件面）
  const componentRules = {
    singleSourceDir: 'frontend/src/components/ui/controls/',
    newButtonClassIsRed: true,
    weightDiscipline: { primary: 500, title: 600, heroOnly: 700 },
    charterSection: '§6',
  };

  // 状态面：registry 文档计数 + active 串行包
  const activePackages = registry.documents.filter((d) => d.kind === 'work-package' && d.status === 'active').map((d) => d.id);
  const reg = {
    documentCount: registry.coverage.documentCount,
    managedMarkdown: registry.coverage.managedMarkdown,
    activeWorkPackages: activePackages,
  };

  // AUDIT-LOG 当前待处理项 🔴/🟢 行数
  const cur = audit.split('## 当前待处理项')[1]?.split('## 最近处理记录')[0] ?? '';
  const unresolvedRows = (cur.match(/^\|\s*(?:🔴|🟢)/gm) || []).length;
  const auditUnresolved = { blocking: unresolvedRows, readyToMerge: 0, total: unresolvedRows };

  return {
    fontTiers: mk(fontTiers, 'docs/design-charter.md §1', 'node scripts/c53-design-baseline.mjs'),
    colorBudget: mk(colorBudget, 'docs/design-charter.md §2', 'node scripts/c53-design-baseline.mjs'),
    borderSemantics: mk(borderSemantics, 'docs/design-charter.md §3', 'node scripts/c53-design-baseline.mjs'),
    motion: mk(motion, 'docs/design-charter.md §4', 'node scripts/c53-design-baseline.mjs'),
    controls: mk(controls, 'docs/design-charter.md §6 + controls/ 现读', 'node scripts/c53-design-baseline.mjs'),
    ratchets: mk(ratchets, 'docs/design-charter.md §7', 'node scripts/c53-design-baseline.mjs'),
    tokenGate: mk(tokenGate, 'frontend/src/styles/theme-token-contract.test.ts', 'cd frontend && npx vitest run src/styles/theme-token-contract.test.ts'),
    uiDebt: mk(uiDebt, 'acceptance/block-332/ui-ledger-triage.json + post-h9-k3-experience.mjs', 'npm run ui:audit:triage'),
    componentRules: mk(componentRules, 'docs/design-charter.md §6', 'node scripts/c53-design-baseline.mjs'),
    registry: mk(reg, 'docs/DOC-REGISTRY.json', 'npm run state'),
    auditUnresolved: mk(auditUnresolved, 'docs/AUDIT-LOG.md §当前待处理项', 'npm run state'),
  };
}

/** 结构完整性 fail-closed：缺读数/缺元数据/value 含 null 子字段即红。 */
export function validateBaselineIntegrity(readings) {
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

const sourceCommitOf = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function buildPack(readings) {
  return {
    schemaVersion: 1,
    id: 'petri-design-context-pack',
    kind: 'model-readable-design-input',
    derivedFrom: [
      'docs/design-charter.md',
      'frontend/src/styles/theme-token-contract.test.ts',
      'acceptance/block-332/ui-ledger-triage.json',
      'frontend/src/components/ui/controls/',
    ],
    font: readings.fontTiers.value,
    color: readings.colorBudget.value,
    border: readings.borderSemantics.value,
    motion: readings.motion.value,
    controls: readings.controls.value,
    ratchets: readings.ratchets.value,
    tokenGate: readings.tokenGate.value,
    uiDebt: readings.uiDebt.value,
    componentRules: readings.componentRules.value,
    boundaries: {
      humanEyeSigned: false,
      readOnly: true,
      note: '观感项 pending_human_eye 保持 in_progress，Agent 不代签；本包为只读资源输入，不改任何运行时行为或 token 定义。',
    },
  };
}

function main(argv) {
  const readings = collectDesignBaseline(ROOT);
  const check = validateBaselineIntegrity(readings);
  if (!check.ok) {
    console.error(`[c53-baseline] 读数不合格，拒绝写盘: ${check.issues.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const sourceCommit = sourceCommitOf(ROOT);
  const snapPath = path.join(ROOT, 'acceptance/block465-c53-p0p1/design-baseline.json');
  const packPath = path.join(ROOT, 'resources/design-context/design-context.json');
  const manifestPath = path.join(ROOT, 'resources/design-context/manifest.json');

  if (argv.includes('--check')) {
    if (!fs.existsSync(snapPath)) { console.error('[c53-baseline] 快照缺席，请先生成'); process.exitCode = 1; return; }
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    for (const id of READING_IDS) {
      try { deepStrictEqual(ownGet(readings, id).value, ownGet(snap.readings, id).value); }
      catch { console.error(`[c53-baseline] --check 漂移: ${id}`); process.exitCode = 1; return; }
    }
    console.log(JSON.stringify({ ok: true, sourceCommit, readingIds: READING_IDS }, null, 2));
    return;
  }

  const frozenReadings = Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id)]));
  const captureContext = Object.fromEntries(CONTEXT_IDS.map((id) => [id, ownGet(readings, id)]));
  const snapshot = {
    schemaVersion: 1,
    kind: 'c53-design-baseline',
    capability: 'block465-c53-design-baseline-context-pack',
    sourceCommit,
    platform: `${os.platform()}-${os.arch()}`,
    command: 'node scripts/c53-design-baseline.mjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'mechanical-gate',
    verdict: 'measured',
    humanEyeEquivalent: false,
    policy: 'readings=设计不变量（冻结，消费测试逐读数深等）；captureContext=捕获时状态（随包开合变化，仅证快照取自干净态，不参与冻结比对）',
    readings: frozenReadings,
    captureContext,
  };
  const pack = buildPack(readings);
  const packBuf = Buffer.from(`${JSON.stringify(pack, null, 2)}\n`, 'utf8');
  const manifest = {
    schemaVersion: 1,
    generator: 'node scripts/c53-design-baseline.mjs',
    sourceCommit,
    generatedAt: new Date().toISOString(),
    note: '模型可读设计上下文包；由 collector 从 canonical 真源派生，被 test/c53-design-context-pack.test.mjs 锚定。',
    files: [{ path: 'design-context.json', sha256: createHash('sha256').update(packBuf).digest('hex') }],
  };

  for (const p of [snapPath, packPath, manifestPath]) fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(snapPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(packPath, packBuf);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ written: [snapPath, packPath, manifestPath].map((p) => path.relative(ROOT, p)), sourceCommit, readingIds: READING_IDS }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
