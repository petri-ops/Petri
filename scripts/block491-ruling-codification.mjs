#!/usr/bin/env node
/**
 * scripts/block491-ruling-codification.mjs — BLOCK-491 / BLOCK-322-RULING D1–D5 裁决固化。
 *
 * collectRulingCodification(root) 是纯函数：从本地主权真源机械复算六组读数，不写产品代码。
 * 本包只固化「用户对 RULING-04 的 D1–D5 裁决已采纳」这一事实 + 冻结边界；
 * 零产品代码写面 / 零新依赖 / 不改 SceneSpec 契约 / 观感 pending_human_eye 零代签 / 不碰 G1+。
 * 几何实现票（P4-05b / P3-03 v2a / v2b / v2c）一律 deferred_user_ruling，逐票待发令。
 *
 *   - rulings              D1–D5 五项：对象/形态值/状态 ruled/用户原话在场
 *   - featureIdentity      D1 派生缓存 + sha/dimensions 版本键 + fail-closed + D3 禁 OCCT 建几何
 *   - referenceSyntax      D2 白名单加键 aFeature/bFeature + 旧场景零迁移 + 非 nodeId#featureId
 *   - implementationTickets 实现票分期与 deferred（P4-05b / v2a / v2b / v2c）
 *   - gdtAcceptance        D5 数值一致性判据 + 禁主观像不像
 *   - boundaries           观感零代签 / 零新依赖 / 不改契约 / 零产品写面 / 不碰 G1+
 *
 * 同一批读数派生 acceptance 快照与 resources/ruling-codification 契约——模型可读、可复算，
 * 被 test/block491-ruling-codification.test.mjs 锚定。
 *
 * 用法：node scripts/block491-ruling-codification.mjs            # 写快照+契约+manifest
 *       node scripts/block491-ruling-codification.mjs --check    # 只重算并与落盘 value 比对
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 冻结读数 ID。 */
export const READING_IDS = Object.freeze([
  'rulings', 'featureIdentity', 'referenceSyntax',
  'implementationTickets', 'gdtAcceptance', 'boundaries',
]);

/** 五项裁决 ID 与用户裁决形态值（2026-11-18 逐项确认）。 */
export const RULING_IDS = Object.freeze(['D1', 'D2', 'D3', 'D4', 'D5']);
export const RULING_FORM = Object.freeze({
  D1: 'derived_cache',
  D2: 'additive_aFeature_bFeature',
  D3: 'occt_readonly_no_build_geometry',
  D4: 'v2a_first',
  D5: 'numeric_consistency',
});
export const RULING_OBJECT = Object.freeze({
  D1: 'feature table truth status',
  D2: 'reference syntax',
  D3: 'forbid OCCT geometry building',
  D4: 'v2 coverage scope',
  D5: 'GD&T acceptance level',
});

/** 实现票（逐票 deferred_user_ruling，需用户发令）。 */
export const DEFERRED_TICKETS = Object.freeze([
  'P4-05b', 'P3-03-v2a', 'P3-03-v2b', 'P3-03-v2c',
]);

/** 冻结下限（只减必红）。 */
export const PATTERN_FLOOR = Object.freeze({
  rulingCount: 5,
  deferredTicketCount: 4,
  owner: 'BLOCK-491：立项现读 2026-11-18；RULING-04 D1–D5 裁决固化 + 契约冻结；零产品写面/观感零代签',
});

// own-enumerable 查找（BLOCK-456 先例），避免 object-injection 告警。
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];
const readText = (rel, root = ROOT) => fs.readFileSync(path.join(root, rel), 'utf8');
const has = (text, re) => re.test(String(text ?? ''));
const read = (root, sourcesOverride, rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);

const RULING_DOC = 'docs/block-322-ruling-04-feature-reference-v2.md';
const PLAN_DOC = 'docs/block491-ruling-codification-plan.md';

/**
 * 纯函数：从材料 §4 抽取某裁决的「状态」段文本。
 * 形如：**D1 特征表的真值地位**：...\n ... *状态*：**ruled（...）**——「...」
 * 取 D{n} 标题起到下一个 D 标题 / 下一节标题之间的块。
 */
function rulingBlock(material, id) {
  const idx = material.indexOf(`**${id} `);
  if (idx < 0) return '';
  const rest = material.slice(idx);
  const next = rest.search(/\n\s*(?:\*\*D[1-5]\s|##\s)/);
  return next < 0 ? rest : rest.slice(0, next);
}

/** 从块中判定形态值：只认「*状态* ... ruled ... 用户裁决形态关键词」共现。 */
const FORM_SIGNALS = Object.freeze({
  D1: [/派生缓存/, /ruled/],
  D2: [/aFeature[、,/`\s]*bFeature|新增\s*`?aFeature/, /ruled/],
  D3: [/禁\s*OCCT\s*建几何|禁止.*建模.*执行器|occt-wasm.*只读分析/, /ruled/],
  D4: [/v2a\s*先行|旋转\s*\+\s*平面/, /ruled/],
  D5: [/数值一致性判据|解析尺寸数值一致/, /ruled/],
});

/** 用户裁决原话关键词（须在 plan §1 或材料块中出现）。 */
const QUOTE_SIGNALS = Object.freeze({
  D1: /D1\s*派生缓存/,
  D2: /D2\s*新增\s*aFeature/,
  D3: /D3\s*禁\s*OCCT\s*建几何/,
  D4: /D4\s*v2a\s*先行/,
  D5: /D5\s*数值一致性判据/,
});

/** 纯函数：五裁决读数。 */
export function scanRulings(root = ROOT, sourcesOverride = null) {
  const material = read(root, sourcesOverride, RULING_DOC);
  const plan = read(root, sourcesOverride, PLAN_DOC);
  const rulings = {};
  for (const id of RULING_IDS) {
    const block = rulingBlock(material, id);
    // status 只由材料 §4 的「*状态* … ruled」标记决定——材料被篡改即回退 pending。
    const isRuled = /\*状态\*[^\n]*ruled/.test(block);
    const signals = ownGet(FORM_SIGNALS, id) ?? [];
    const formMatches = signals.every((re) => re.test(block));
    Object.assign(rulings, { [id]: {
      object: ownGet(RULING_OBJECT, id),
      form: isRuled && formMatches ? ownGet(RULING_FORM, id) : 'undetermined',
      status: isRuled ? 'ruled' : 'pending_user_ruling',
      hasUserQuote: has(plan, ownGet(QUOTE_SIGNALS, id)),
      ruledAt: isRuled ? '2026-11-18' : null,
    } });
  }
  return { rulings, rulingCount: Object.keys(rulings).length };
}

/** 纯函数：D1 派生缓存 + D3 禁 OCCT 建几何。 */
export function scanFeatureIdentity(root = ROOT, sourcesOverride = null) {
  const material = read(root, sourcesOverride, RULING_DOC);
  const charter = read(root, sourcesOverride, 'AGENTS.md');
  return {
    derivedCache: has(material, /派生缓存/),
    versionKeyShaDimensions: has(material, /sourceSha256[\s\S]{0,120}dimensions|dimensions[\s\S]{0,120}sourceSha256/),
    mismatchFailClosed: has(material, /派生表与源不一致即\s*fail-closed|不一致即\s*fail-closed/),
    noSecondSourceOfTruth: has(material, /不造第二场景真值|不产生第二场景真值/) || has(charter, /第二套真值|第二真值/),
    occtReadOnly: has(material, /occt-wasm`?\s*只做只读分析|只读分析/),
    noOcctBuildGeometry: has(material, /不得成为构建执行器|建模 API\s*建几何|第二个几何执行器/),
  };
}

/** 纯函数：D2 引用语法。 */
export function scanReferenceSyntax(root = ROOT, sourcesOverride = null) {
  const material = read(root, sourcesOverride, RULING_DOC);
  return {
    additiveWhiteListKeys: has(material, /白名单加键|白名单.*加键|新增\s*`?aFeature/),
    aFeatureBFeature: has(material, /aFeature[\s\S]{0,80}bFeature|bFeature/),
    zeroLegacyMigration: has(material, /旧场景零迁移/),
    notNodeIdFeatureString: has(material, /而不是把\s*`?a`?\/`?b`?[\s\S]{0,120}nodeId#featureId|不采用\s*`?nodeId#featureId/),
    contractChangeDeferred: has(material, /SceneSpec\s*契约变更|契约变更属后续实现票/),
  };
}

/** 纯函数：实现票分期与 deferred。 */
export function scanImplementationTickets(root = ROOT, sourcesOverride = null) {
  const material = read(root, sourcesOverride, RULING_DOC);
  const plan = read(root, sourcesOverride, PLAN_DOC);
  const tickets = {};
  const ticketSignals = Object.freeze({
    'P4-05b': /P4-05b/,
    'P3-03-v2a': /P3-03\s*v2a|v2a/,
    'P3-03-v2b': /P3-03\s*v2b|v2b/,
    'P3-03-v2c': /P3-03\s*v2c|v2c/,
  });
  for (const id of DEFERRED_TICKETS) {
    const signal = ownGet(ticketSignals, id);
    const inScope = has(material, signal) && has(plan, signal);
    const markedActive = new RegExp(`${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]{0,120}(active|in_progress|已开工)`).test(plan);
    Object.assign(tickets, { [id]: {
      status: inScope && !markedActive ? 'deferred_user_ruling' : 'undetermined',
      needsUserOrder: true,
    } });
  }
  return {
    tickets,
    v2cSeparated: has(material, /v2c\s*单列|v2c\s*单列\s*deferred|v2c（曲面\/边）单列/),
    noImplementationStarted: has(plan, /不启动任何\s*SceneSpec|不启动任何几何|零产品代码写面/),
  };
}

/** 纯函数：D5 GD&T 数值判据。 */
export function scanGdtAcceptance(root = ROOT, sourcesOverride = null) {
  const material = read(root, sourcesOverride, RULING_DOC);
  return {
    annotationText: has(material, /标注文本/),
    viewProjectionCoords: has(material, /视图投影坐标|两端点的视图投影坐标/),
    numericConsistency: has(material, /解析尺寸数值一致|可代数的值/),
    noSubjectiveLooksRight: has(material, /不做[「"][^」"]*像不像|禁.*像不像|不做.*主观验收/),
  };
}

/** 依赖块文本；dependencies 段单独抽出用于计数（BLOCK-481 先例）。 */
const DEP_BLOCK = /"(?:dependencies|devDependencies)"\s*:\s*\{([^{}]*)\}/g;
const depText = (...pkgs) => pkgs.map((t) => (String(t ?? '').match(DEP_BLOCK) || []).join('\n')).join('\n');
const NEW_DEP_FINGERPRINT = /(?:some-new-heavy-dep|occt-constraint-solver|freecad|sand3d|three-live)/i;

/** 纯函数：边界。 */
export function scanBoundaries(root = ROOT, sourcesOverride = null) {
  const rootPkg = read(root, sourcesOverride, 'package.json');
  const frontPkg = read(root, sourcesOverride, 'frontend/package.json');
  const noNewDependency = !NEW_DEP_FINGERPRINT.test(depText(rootPkg, frontPkg));
  const ledger = read(root, sourcesOverride, 'docs/ui-productization-audit.md');
  const sections = new Map();
  for (const m of ledger.matchAll(/^## (UI-\d+):[^\n]*(?:\n(?!(?:## |# ))[^\n]*)*/gm)) sections.set(m[1], m[0]);
  const eyeIds = Object.freeze(['UI-706', 'UI-707', 'UI-709', 'UI-710']);
  let humanEyeZeroSign = true;
  for (const id of eyeIds) {
    const sec = sections.get(id) ?? '';
    if (!has(sec, /in_progress/i) || !has(sec, /pending_human_eye/i)
      || has(sec, /\*\*verified\*\*|→\s*\*\*verified\*\*|状态.{0,12}verified/i)) humanEyeZeroSign = false;
  }
  const plan = read(root, sourcesOverride, PLAN_DOC);
  const charter = read(root, sourcesOverride, 'AGENTS.md');
  return {
    humanEyeZeroSign,
    noNewDependency,
    noSceneSpecContractChange: has(plan, /不改\s*SceneSpec\s*契约|不改契约|零\s*SceneSpec\s*契约变更/),
    noProductCodeWrite: has(plan, /不动产品代码|零产品代码写面|不改任何产品代码/),
    noG1Plus: has(plan, /不碰\s*G1\+|不外推\s*packaged\/Provider\/GA/) && has(charter, /G0 开发期/),
  };
}

/** 完整性校验：任一下限/不变量违约即 ok=false（篡改负测 fail-closed）。 */
export function validateRulingCodificationIntegrity(readings) {
  const issues = [];
  const get = (id) => ownGet(readings ?? {}, id)?.value;
  if (!READING_IDS.every((id) => ownGet(readings ?? {}, id))) {
    return { ok: false, issues: ['读数结构不完整'] };
  }
  const r = get('rulings');
  if (!r || r.rulingCount !== PATTERN_FLOOR.rulingCount) issues.push('rulings 数量违约');
  else for (const id of RULING_IDS) {
    const row = ownGet(r.rulings, id);
    if (!row || row.status !== 'ruled' || row.form !== ownGet(RULING_FORM, id)
      || row.hasUserQuote !== true || row.ruledAt !== '2026-11-18') issues.push(`${id} 裁决违约`);
  }
  const f = get('featureIdentity');
  if (!f || !f.derivedCache || !f.versionKeyShaDimensions || !f.mismatchFailClosed
    || !f.noSecondSourceOfTruth || !f.occtReadOnly || !f.noOcctBuildGeometry) issues.push('featureIdentity 违约');
  const s = get('referenceSyntax');
  if (!s || !s.additiveWhiteListKeys || !s.aFeatureBFeature || !s.zeroLegacyMigration
    || !s.notNodeIdFeatureString || !s.contractChangeDeferred) issues.push('referenceSyntax 违约');
  const t = get('implementationTickets');
  if (!t || Object.keys(t.tickets ?? {}).length !== PATTERN_FLOOR.deferredTicketCount
    || !DEFERRED_TICKETS.every((id) => ownGet(t.tickets, id)?.status === 'deferred_user_ruling' && ownGet(t.tickets, id)?.needsUserOrder === true)
    || !t.v2cSeparated || !t.noImplementationStarted) issues.push('implementationTickets 违约');
  const g = get('gdtAcceptance');
  if (!g || !g.annotationText || !g.viewProjectionCoords || !g.numericConsistency || !g.noSubjectiveLooksRight) issues.push('gdtAcceptance 违约');
  const b = get('boundaries');
  if (!b || !b.humanEyeZeroSign || !b.noNewDependency || !b.noSceneSpecContractChange
    || !b.noProductCodeWrite || !b.noG1Plus) issues.push('boundaries 违约');
  return { ok: issues.length === 0, issues };
}

/** 纯函数：六组读数汇总，每项带 source/command/capturedAt。违反不变量即抛。 */
export function collectRulingCodification(root = ROOT) {
  const cmd = 'node scripts/block491-ruling-codification.mjs';
  const mk = (value, source) => ({ value, source, command: cmd, capturedAt: 'freeze-invariant' });
  const readings = {
    rulings: mk(scanRulings(root), 'RULING-04 材料 §4 + BLOCK-491 plan §1 用户原话'),
    featureIdentity: mk(scanFeatureIdentity(root), 'RULING-04 材料 §2/§4 + AGENTS.md 红线'),
    referenceSyntax: mk(scanReferenceSyntax(root), 'RULING-04 材料 §4 D2'),
    implementationTickets: mk(scanImplementationTickets(root), 'RULING-04 材料 §5 + BLOCK-491 plan §4'),
    gdtAcceptance: mk(scanGdtAcceptance(root), 'RULING-04 材料 §4 D5'),
    boundaries: mk(scanBoundaries(root), 'BLOCK-491 plan §3 + AGENTS.md + UI 台账 + package.json'),
  };
  const check = validateRulingCodificationIntegrity(readings);
  if (!check.ok) throw new Error(`[block491:ruling] 读数不合格: ${check.issues.join('; ')}`);
  return readings;
}

const sourceCommitOf = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function buildContract(readings, sourceCommit) {
  const val = (id) => ownGet(readings, id).value;
  return {
    kind: 'model-readable-ruling-codification',
    id: 'BLOCK-491 / BLOCK-322-RULING D1–D5',
    capability: 'block491-ruling-codification',
    rulingStatus: 'ruled',
    ruledAt: '2026-11-18',
    sourcePackage: 'docs/block-322-ruling-04-feature-reference-v2.md',
    codificationPlan: 'docs/block491-ruling-codification-plan.md',
    sourceCommit,
    readings: Object.fromEntries(READING_IDS.map((id) => [id, val(id)])),
    boundaries: {
      readOnly: true,
      noImplementation: true,
      noSceneSpecContractChange: true,
      noNewDependency: true,
      humanEyeSigned: false,
      noG1Plus: true,
    },
    generatedAt: new Date().toISOString(),
  };
}

function main(argv) {
  let readings;
  try {
    readings = collectRulingCodification(ROOT);
  } catch (err) {
    console.error(`[block491:ruling] ${err.message}`);
    process.exitCode = 1;
    return;
  }
  const check = validateRulingCodificationIntegrity(readings);
  if (!check.ok) {
    console.error(`[block491:ruling] 读数不合格，拒绝写盘: ${check.issues.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const sourceCommit = sourceCommitOf(ROOT);
  const snapshotDir = path.join(ROOT, 'acceptance/block491-ruling-codification');
  const contractDir = path.join(ROOT, 'resources/ruling-codification');
  fs.mkdirSync(snapshotDir, { recursive: true });
  fs.mkdirSync(contractDir, { recursive: true });
  const contract = buildContract(readings, sourceCommit);
  const contractBuf = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  const contractPath = path.join(contractDir, 'block322-ruling-codification.json');
  const sha = createHash('sha256').update(contractBuf).digest('hex');

  if (argv.includes('--check')) {
    const snapOnDisk = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'ruling-codification-snapshot.json'), 'utf8'));
    const contractOnDiskBuf = fs.readFileSync(contractPath);
    const contractOnDisk = JSON.parse(contractOnDiskBuf);
    for (const id of READING_IDS) {
      deepStrictEqual(ownGet(readings, id).value, ownGet(snapOnDisk.readings, id).value, `读数 ${id} 复算不一致`);
    }
    deepStrictEqual(contract.rulings ?? contract.readings.rulings, contractOnDisk.readings.rulings, '契约 rulings 复算不一致');
    const manifest = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'manifest.json'), 'utf8'));
    const entry = manifest.files.find((f) => ownGet(f, 'path') === 'block322-ruling-codification.json');
    if (!entry || entry.sha256 !== createHash('sha256').update(contractOnDiskBuf).digest('hex')) {
      throw new Error('[block491:ruling] manifest sha256 与契约文件不一致');
    }
    console.log(`[block491:ruling] --check PASS: 6 读数复算一致 + manifest sha256=${entry.sha256.slice(0, 12)}…`);
    return;
  }

  const snapshot = {
    kind: 'block491-ruling-codification',
    sourceCommit,
    platform: os.platform(),
    capturedAt: new Date().toISOString(),
    readings,
  };
  fs.writeFileSync(path.join(snapshotDir, 'ruling-codification-snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(contractPath, contractBuf);
  const manifest = {
    kind: 'block491-ruling-codification-manifest',
    sourceCommit,
    files: [
      { path: 'block322-ruling-codification.json', sha256: sha, bytes: contractBuf.length },
    ],
  };
  fs.writeFileSync(path.join(snapshotDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[block491:ruling] 写盘完成: 6 读数 + 契约 sha256=${sha.slice(0, 12)}…`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main(process.argv.slice(2));
}
