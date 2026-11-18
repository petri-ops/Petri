#!/usr/bin/env node
/**
 * scripts/c53-skill-contract.mjs — BLOCK-475 / C-53 P6：产品 Skill v1.1 契约扫描。
 *
 * collectSkillContract(root) 是纯函数：从 canonical 真源机械复算六组读数，不写盘语义部分、不依赖时间：
 *   - designContextConsumption  design-brief README/system 对 design-context 五件套的引用
 *   - iaConsumption             对 ia-map / 路由 / 高频路径 / 重定向契约的引用
 *   - a11yConstraints           对键盘/焦点/ARIA/对比度/触摸目标/断点 + responsive-a11y.json 的引用
 *   - skillVersionContract      skill.json / manifest 版本对齐 + capabilities 增补 + builtinSha256 现读一致
 *   - bridgeAlignment           Agent skill Governing sources + .codebuddy 发现桥 symlink 真链
 *   - humanEyeSlots             观感留槽（pending_human_eye 保持 in_progress，零代签）
 * 同一批读数派生 acceptance 快照与 resources/design-context/skill-contract.json
 * ——模型可读、可复算，被 test/c53-skill-contract.test.mjs 锚定。
 *
 * 用法：node scripts/c53-skill-contract.mjs            # 写快照+契约+manifest
 *       node scripts/c53-skill-contract.mjs --check    # 只重算并与落盘 value 比对
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';
import { builtinDigest } from './post-s7-skill-integrity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 冻结读数 = 设计不变量，被消费测试逐读数深等。 */
export const READING_IDS = Object.freeze([
  'designContextConsumption', 'iaConsumption', 'a11yConstraints',
  'skillVersionContract', 'bridgeAlignment', 'humanEyeSlots',
]);

/** 冻结契约下限（只减必红）：现读引用集合，缺任一必红。 */
export const SKILL_FLOOR = Object.freeze({
  contextFiles: Object.freeze([
    'design-context.json', 'ia-map.json', 'visual-consistency.json',
    'responsive-a11y.json', 'performance-trust.json',
  ]),
  iaKeywords: Object.freeze({ iaMap: true, route: true, highFreqPath: true, redirect: true }),
  a11yKeywords: Object.freeze({ keyboard: true, focus: true, aria: true, contrast: true, touchTarget: true, breakpoint: true }),
  capabilities: Object.freeze(['design-context-consumption', 'ia-map-consumption', 'a11y-constraints']),
  humanEyeSlots: 2,
  version: '1.1.0',
  owner: 'BLOCK-475 / C-53 P6：立项现读 2026-11-18；引用/版本/桥缺失必红；观感归 E 不代签',
});

const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];
const readText = (rel, root = ROOT) => fs.readFileSync(path.join(root, rel), 'utf8');
const has = (text, re) => re.test(String(text ?? ''));

/** design-brief README + system.md 对 design-context 五件套的引用。 */
export function scanDesignContextConsumption(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const readme = read('resources/skills/design-brief/README.md');
  const system = read('resources/skills/design-brief/prompts/system.md');
  const src = `${readme}\n${system}`;
  const fileRefs = Object.fromEntries(SKILL_FLOOR.contextFiles.map((f) => [f, src.includes(f)]));
  return {
    fileRefs,
    manifestRef: has(src, /resources\/design-context\/manifest\.json/),
    dirRef: has(src, /resources\/design-context\//),
    referenceCount: Object.values(fileRefs).filter(Boolean).length,
  };
}

/** 对 IA 映射真源的消费关键词。 */
export function scanIaConsumption(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const src = `${read('resources/skills/design-brief/README.md')}\n${read('resources/skills/design-brief/prompts/system.md')}`;
  return {
    keywords: {
      iaMap: has(src, /ia-map/i),
      route: has(src, /路由|routes?/i),
      highFreqPath: has(src, /高频路径|high.?frequency/i),
      redirect: has(src, /重定向|redirect/i),
    },
    iaMapRef: has(src, /ia-map\.json/),
  };
}

/** 对响应式 a11y 契约的消费关键词。 */
export function scanA11yConstraints(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const src = `${read('resources/skills/design-brief/README.md')}\n${read('resources/skills/design-brief/prompts/system.md')}`;
  return {
    keywords: {
      keyboard: has(src, /键盘|keyboard/i),
      focus: has(src, /焦点|focus/i),
      aria: has(src, /ARIA/i),
      contrast: has(src, /对比度|contrast/i),
      touchTarget: has(src, /触摸目标|touch.?target/i),
      breakpoint: has(src, /断点|breakpoint/i),
    },
    a11yContractRef: has(src, /responsive-a11y\.json/),
  };
}

/** Skill 版本契约：skill.json / manifest 对齐 + capabilities + builtinSha256 现读一致。 */
export function scanSkillVersionContract(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const skill = JSON.parse(read('resources/skills/design-brief/skill.json'));
  const manifest = JSON.parse(read('resources/skills/manifest.json'));
  const dEntry = ownGet(manifest.skills ?? {}, 'design-brief');
  const caps = new Set(Array.isArray(skill.capabilities) ? skill.capabilities : []);
  const capabilities = Object.fromEntries(SKILL_FLOOR.capabilities.map((c) => [c, caps.has(c)]));
  const recorded = dEntry?.integrity?.builtinSha256;
  const currentDigest = builtinDigest(path.join(root, 'resources/skills/design-brief'));
  return {
    skillJsonVersion: skill.version ?? null,
    manifestVersion: dEntry?.version ?? null,
    versionAligned: skill.version === SKILL_FLOOR.version && dEntry?.version === SKILL_FLOOR.version,
    capabilities,
    integrityCurrent: Boolean(recorded) && recorded === currentDigest,
  };
}

/** 发现桥对齐：Agent skill Governing sources + .codebuddy symlink 真链。 */
export function scanBridgeAlignment(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const agentSkill = read('.agents/skills/petri-ui-design/SKILL.md');
  const linkPath = path.join(root, '.codebuddy/skills/petri-ui-design');
  let codebuddyBridgeReal = false;
  let bridgeTargetCorrect = false;
  try {
    const st = fs.lstatSync(linkPath);
    codebuddyBridgeReal = st.isSymbolicLink();
    const target = fs.readlinkSync(linkPath);
    bridgeTargetCorrect = /\.agents\/skills\/petri-ui-design$/.test(target.replace(/\\/g, '/'));
  } catch { /* symlink 缺席 → 两 false，fail-closed */ }
  return {
    agentSkillGoverningSources: has(agentSkill, /resources\/design-context\//) && has(agentSkill, /manifest\.json/),
    agentSkillIaRef: has(agentSkill, /ia-map\.json/),
    agentSkillA11yRef: has(agentSkill, /responsive-a11y\.json/),
    codebuddyBridgeReal,
    bridgeTargetCorrect,
  };
}

/** 观感留槽：本包零观感写面，pending_human_eye 保持 in_progress。 */
function collectHumanEyeSlots() {
  return {
    humanEyeSigned: false,
    status: 'in_progress',
    slots: [
      'C-53 P7 人眼收口（pending_human_eye，待用户实机过目）',
      'UI-706/707/709/710 + E 类观感签字（pending_human_eye，待用户实机过目）',
    ],
    readOnly: true,
    note: 'Agent 不代签观感；本包只升级产品 Skill 契约并机械复算，观感签字槽留用户。',
  };
}

/** 结构完整性 fail-closed：缺读数/缺元数据/value 含 null 子字段即红。 */
export function validateSkillContractIntegrity(readings) {
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
export function collectSkillContract(root = ROOT) {
  const capturedAt = new Date().toISOString();
  const mk = (value, source, command) => ({ value, source, command, capturedAt });
  const cmd = 'node scripts/c53-skill-contract.mjs';

  const designContextConsumption = scanDesignContextConsumption(root);
  const iaConsumption = scanIaConsumption(root);
  const a11yConstraints = scanA11yConstraints(root);
  const skillVersionContract = scanSkillVersionContract(root);
  const bridgeAlignment = scanBridgeAlignment(root);
  const humanEyeSlots = collectHumanEyeSlots();

  // fail-closed：任何契约级违例直接抛错，拒绝生成"看起来绿的"快照。
  for (const f of SKILL_FLOOR.contextFiles) {
    if (!ownGet(designContextConsumption.fileRefs, f)) throw new Error(`[c53:skill] 缺 design-context 引用: ${f}`);
  }
  if (!designContextConsumption.manifestRef || !designContextConsumption.dirRef) {
    throw new Error('[c53:skill] 缺 manifest / 目录引用');
  }
  for (const [k, required] of Object.entries(SKILL_FLOOR.iaKeywords)) {
    if (required && !ownGet(iaConsumption.keywords, k)) throw new Error(`[c53:skill] 缺 IA 消费关键词: ${k}`);
  }
  if (!iaConsumption.iaMapRef) throw new Error('[c53:skill] 缺 ia-map.json 引用');
  for (const [k, required] of Object.entries(SKILL_FLOOR.a11yKeywords)) {
    if (required && !ownGet(a11yConstraints.keywords, k)) throw new Error(`[c53:skill] 缺 a11y 消费关键词: ${k}`);
  }
  if (!a11yConstraints.a11yContractRef) throw new Error('[c53:skill] 缺 responsive-a11y.json 引用');
  if (!skillVersionContract.versionAligned) throw new Error(`[c53:skill] 版本漂移: ${JSON.stringify(skillVersionContract)}`);
  for (const c of SKILL_FLOOR.capabilities) {
    if (!ownGet(skillVersionContract.capabilities, c)) throw new Error(`[c53:skill] 缺 capability: ${c}`);
  }
  if (!skillVersionContract.integrityCurrent) throw new Error('[c53:skill] builtinSha256 未重算对齐');
  if (!bridgeAlignment.agentSkillGoverningSources || !bridgeAlignment.agentSkillIaRef || !bridgeAlignment.agentSkillA11yRef) {
    throw new Error('[c53:skill] Agent skill Governing sources 未纳入真源');
  }
  if (!bridgeAlignment.codebuddyBridgeReal || !bridgeAlignment.bridgeTargetCorrect) {
    throw new Error('[c53:skill] .codebuddy 发现桥非真链或目标漂移');
  }
  if (humanEyeSlots.humanEyeSigned || humanEyeSlots.status !== 'in_progress') {
    throw new Error('[c53:skill] 观感留槽被代签或状态非 in_progress');
  }

  return {
    designContextConsumption: mk(designContextConsumption, 'design-brief README.md + prompts/system.md', cmd),
    iaConsumption: mk(iaConsumption, 'design-brief README.md + prompts/system.md + ia-map.json', cmd),
    a11yConstraints: mk(a11yConstraints, 'design-brief README.md + prompts/system.md + responsive-a11y.json', cmd),
    skillVersionContract: mk(skillVersionContract, 'design-brief skill.json + skills/manifest.json + post-s7-skill-integrity', cmd),
    bridgeAlignment: mk(bridgeAlignment, '.agents/skills/petri-ui-design/SKILL.md + .codebuddy 发现桥 symlink', cmd),
    humanEyeSlots: mk(humanEyeSlots, 'UI 台账 pending_human_eye（观感零代签）', cmd),
  };
}

const sourceCommitOf = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function main(argv) {
  const readings = collectSkillContract(ROOT);
  const check = validateSkillContractIntegrity(readings);
  if (!check.ok) {
    console.error(`[c53:skill] 读数不合格，拒绝写盘: ${check.issues.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const sourceCommit = sourceCommitOf(ROOT);
  const snapPath = path.join(ROOT, 'acceptance/block475-c53-p6-skill-contract/skill-contract-snapshot.json');
  const contractPath = path.join(ROOT, 'resources/design-context/skill-contract.json');
  const manifestPath = path.join(ROOT, 'resources/design-context/manifest.json');

  if (argv.includes('--check')) {
    if (!fs.existsSync(snapPath)) { console.error('[c53:skill] 快照缺席，请先生成'); process.exitCode = 1; return; }
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    for (const id of READING_IDS) {
      try { deepStrictEqual(ownGet(readings, id).value, ownGet(snap.readings, id).value); }
      catch { console.error(`[c53:skill] --check 漂移: ${id}`); process.exitCode = 1; return; }
    }
    console.log(JSON.stringify({
      ok: true,
      sourceCommit,
      readingIds: READING_IDS,
      contextRefs: ownGet(readings, 'designContextConsumption').value.referenceCount,
      iaRef: ownGet(readings, 'iaConsumption').value.iaMapRef,
      a11yRef: ownGet(readings, 'a11yConstraints').value.a11yContractRef,
      version: ownGet(readings, 'skillVersionContract').value.skillJsonVersion,
      bridgeReal: ownGet(readings, 'bridgeAlignment').value.codebuddyBridgeReal,
    }, null, 2));
    return;
  }

  const frozenReadings = Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id)]));
  const snapshot = {
    schemaVersion: 1,
    kind: 'c53-skill-contract',
    capability: 'block475-c53-p6-skill-contract',
    sourceCommit,
    platform: `${os.platform()}-${os.arch()}`,
    command: 'node scripts/c53-skill-contract.mjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'mechanical-gate',
    verdict: 'measured',
    humanEyeEquivalent: false,
    note: '读数=机械不变量（冻结，消费测试逐读数深等）；观感项 pending_human_eye 不代签，本包只升级产品 Skill 契约，不改任何 UI 运行时代码。',
    readings: frozenReadings,
  };

  const contract = {
    schemaVersion: 1,
    id: 'petri-skill-contract',
    kind: 'model-readable-skill-contract',
    generatedBy: 'node scripts/c53-skill-contract.mjs',
    sourceCommit,
    generatedAt: new Date().toISOString(),
    derivedFrom: [
      'resources/skills/design-brief/README.md + prompts/system.md（设计上下文真源消费）',
      'resources/design-context/ 五件套（design-context / ia-map / visual-consistency / responsive-a11y / performance-trust）',
      'resources/skills/design-brief/skill.json + resources/skills/manifest.json（版本契约）',
      '.agents/skills/petri-ui-design/SKILL.md + .codebuddy 发现桥 symlink（对齐）',
    ],
    designContextConsumption: ownGet(readings, 'designContextConsumption').value,
    iaConsumption: ownGet(readings, 'iaConsumption').value,
    a11yConstraints: ownGet(readings, 'a11yConstraints').value,
    skillVersionContract: ownGet(readings, 'skillVersionContract').value,
    bridgeAlignment: ownGet(readings, 'bridgeAlignment').value,
    humanEyeSlots: ownGet(readings, 'humanEyeSlots').value,
    boundaries: {
      humanEyeSigned: false,
      readOnly: true,
      note: '观感项（P7 人眼收口 / UI-706/707/709/710 + E 类）pending_human_eye 保持 in_progress，Agent 不代签；本契约为只读机械扫描，不改任何 UI 运行时代码。',
    },
  };

  const contractBuf = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  for (const p of [snapPath, contractPath, manifestPath]) fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(snapPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(contractPath, contractBuf);

  // manifest 同步（沿 P1–P5 先例）：skill-contract 的 sha256 由生成器自身维护。
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const sha = createHash('sha256').update(contractBuf).digest('hex');
  const entry = files.find((f) => ownGet(f, 'path') === 'skill-contract.json');
  if (entry) entry.sha256 = sha;
  else files.push({ path: 'skill-contract.json', sha256: sha });
  manifest.files = files;
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    written: [snapPath, contractPath, manifestPath].map((p) => path.relative(ROOT, p)),
    sourceCommit,
    readingIds: READING_IDS,
    contextRefs: ownGet(readings, 'designContextConsumption').value.referenceCount,
    version: ownGet(readings, 'skillVersionContract').value.skillJsonVersion,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
