#!/usr/bin/env node
/**
 * scripts/c52-reference-board-review.mjs — BLOCK-481 / C-52 P5（参考板与评审法）模式借鉴契约冻结扫描。
 *
 * collectReferenceBoardReview(root) 是纯函数：从 canonical 真源机械复算六组读数，不写产品代码。
 * C-52 P5 只做 Pinterest 灵感画板 / Refero DESIGN.md 结构化 / CTA-Footer 模块级观察 /
 * 仅评审素材不进产品的「评审方法借鉴 + 契约冻结」——Petri 已有本地主权评审法锚点，
 * 零新增产品依赖、不复制品牌资产、不照搬营销 CTA-Footer 模式、观感 pending_human_eye 零代签。
 * 本包为 C-52 余项（P2–P5）收官包。
 *   - inspirationBoard      灵感画板法（reference-analysis 五步 / 观察-借鉴分离 / 只取设计原子 / Pinterest 行）
 *   - structuredDesignMd    DESIGN.md 结构化（brief 十节 / Skill v1.1.0 / design-context / ia-map / Refero 行）
 *   - moduleObservation     模块级观察（八态矩阵 / 交付前 checklist / CTA-Footer 工具矩阵行）
 *   - reviewMaterialOnly    仅评审素材不进产品（前端零品牌指纹 / 零新依赖 / 内部参考 / 产品-内部决策分离）
 *   - licenseProvenance     来源许可登记（四来源 / P5 条目 / provenance / license_unknown / brief §9）
 *   - boundaries            边界（观感零签 / 零依赖 / 不替换 SimpleChat / 不抄整页 / 不全局换皮）
 * 同一批读数派生 acceptance 快照与 resources/design-context/reference-board-review.json
 * ——模型可读、可复算，被 test/c52-reference-board-review.test.mjs 锚定。
 *
 * 用法：node scripts/c52-reference-board-review.mjs            # 写快照+契约+manifest
 *       node scripts/c52-reference-board-review.mjs --check    # 只重算并与落盘 value 比对
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
  'inspirationBoard', 'structuredDesignMd', 'moduleObservation',
  'reviewMaterialOnly', 'licenseProvenance', 'boundaries',
]);

/** 冻结下限（只减必红）：现读锚点数/节数/状态数/来源数/依赖上限。 */
export const PATTERN_FLOOR = Object.freeze({
  analysisSteps: 5,
  briefSections: 10,
  stateMatrixStates: 8,
  licenseSources: 4,
  frontendDependencyCeiling: 45,
  owner: 'BLOCK-481 / C-52 P5：立项现读 2026-11-18；参考板与评审法借鉴+契约冻结；仅评审素材不进产品/观感零代签',
});

/** 品牌 / UI kit 来源指纹（前端源出现即红；infima 是既有基线不在内）。P5 扩展 Pinterest/Refero/CTA/Footer。 */
const BRAND_FINGERPRINT = /(?:pinterest|refero|cta[_-]?gallery|footer[_-]?design|21st(?:\.dev)?|shadcn|magicui|aceternity|@radix-ui|framer-motion|assistant-ui|react-bits)/i;

/** 许可证与来源登记（只记录、不引入依赖、不复制品牌资产）。与 C-52 P2/P3/P4 同源冻结。 */
export const LICENSE_REGISTER = Object.freeze({
  'assistant-ui': 'MIT · 仅形态借鉴（流式消息/工具确认/附件/结构化数据/选项列表），不引入运行时依赖、不复制代码',
  'React Bits': 'MIT + Commons Clause · 仅反馈型微动效模式观察（hover/press/展开/成功反馈），复用 --petri-duration/ease token，保留版权、禁整页动效、禁转售组件本身',
  '21st.dev': '逐组件查许可 · 仅组件/模板片段灵感（P4 候选），防风格漂移与依赖膨胀',
  'Pinterest/Refero/CTA/Footer': '灵感画板与结构化评审法（P5 候选），仅评审素材不进产品',
});

// own-enumerable 查找（BLOCK-456 先例），避免 object-injection 告警。
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];
const readText = (rel, root = ROOT) => fs.readFileSync(path.join(root, rel), 'utf8');
const has = (text, re) => re.test(String(text ?? ''));
const count = (text, re) => (String(text ?? '').match(re) || []).length;

/** 递归遍历前端源（与 theme-token-contract CSS_FILES() / C-53 P3 同口径）。 */
function walkFrontend(root) {
  const base = path.join(root, 'frontend/src');
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(css|ts|tsx|js|jsx)$/.test(entry.name)) continue;
      if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      out.push(full);
    }
  };
  walk(base);
  return out;
}

/** 前端源文本映射：真实源 + 注入源（sourcesOverride 中以 frontend/src/ 开头的条目）。 */
function frontendSources(root, sourcesOverride) {
  const map = new Map();
  for (const file of walkFrontend(root)) {
    map.set(path.relative(path.join(root, 'frontend/src'), file).replaceAll('\\', '/'), fs.readFileSync(file, 'utf8'));
  }
  for (const [rel, text] of Object.entries(sourcesOverride ?? {})) {
    if (rel.startsWith('frontend/src/')) map.set(rel.slice('frontend/src/'.length), String(text));
  }
  return map;
}

/** 纯函数：灵感画板法（Pinterest 评审法锚点）。 */
export function scanInspirationBoard(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const analysis = read('.agents/skills/petri-ui-design/references/reference-analysis.md');
  const tool = read('.agents/skills/petri-ui-design/references/tool-adoption-matrix.md');
  return {
    analysisSteps: count(analysis, /^## Step [0-9]+:/gm),
    observationBorrowSplit: has(analysis, /Separate observation from borrowing/),
    designAtomsOnly: has(analysis, /Extract design atoms only/) && has(analysis, /whole-page layouts or exact component skins/),
    pinterestBoardMethod: has(tool, /\|\s*Pinterest\s*\|[^\n]*Reference-board method/)
      && has(tool, /\|\s*Pinterest\s*\|[^\n]*Internal reference process only/),
  };
}

/** 纯函数：DESIGN.md 结构化（Refero 评审法锚点）。 */
export function scanStructuredDesignMd(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const brief = read('.agents/skills/petri-ui-design/references/design-brief-template.md');
  const skill = read('resources/skills/design-brief/skill.json');
  const context = read('resources/design-context/design-context.json');
  const iaMap = read('resources/design-context/ia-map.json');
  const tool = read('.agents/skills/petri-ui-design/references/tool-adoption-matrix.md');
  return {
    briefSections: count(brief, /^## [0-9]+\. /gm),
    briefSkillV110: has(skill, /"version"\s*:\s*"1\.1\.0"/),
    designContextPack: has(context, /"id"\s*:\s*"petri-design-context-pack"/),
    iaMapPresent: has(iaMap, /"routes"\s*:/) && has(iaMap, /"highFrequencyPaths"\s*:/),
    referoStructuredMethod: has(tool, /\|\s*Refero Styles\s*\|[^\n]*structured/)
      && has(tool, /\|\s*Refero Styles\s*\|[^\n]*feed design brief/),
  };
}

/** 纯函数：模块级观察（CTA/Footer 评审法锚点）。 */
export function scanModuleObservation(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const matrix = read('.agents/skills/petri-ui-design/references/module-state-matrix.md');
  const checklist = read('.agents/skills/petri-ui-design/references/review-checklist.md');
  const tool = read('.agents/skills/petri-ui-design/references/tool-adoption-matrix.md');
  const states = ['default', 'hover', 'active', 'disabled', 'loading', 'empty', 'error', 'focus-visible'];
  return {
    stateMatrixStates: states.filter((s) => has(matrix, new RegExp(`\\|\\s*\\\`${s}\\\`\\s*\\|`))).length,
    preDeliveryChecklist: has(checklist, /Pre-delivery Review Checklist/),
    ctaActionHierarchy: has(tool, /\|\s*CTA Gallery\s*\|[^\n]*Primary\/secondary action hierarchy/),
    footerGrouping: has(tool, /\|\s*Footer Design\s*\|[^\n]*Information grouping for footers/),
  };
}

/** 纯函数：仅评审素材不进产品（前端零品牌指纹 + 零依赖 + 内部参考 + 产品/内部决策分离）。 */
export function scanReviewMaterialOnly(root = ROOT, sourcesOverride = null) {
  let noBrandFingerprint = true;
  for (const text of frontendSources(root, sourcesOverride).values()) {
    if (BRAND_FINGERPRINT.test(text)) noBrandFingerprint = false;
  }
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const tool = read('.agents/skills/petri-ui-design/references/tool-adoption-matrix.md');
  const analysis = read('.agents/skills/petri-ui-design/references/reference-analysis.md');
  return {
    noBrandFingerprint,
    zeroNewDependencies: has(tool, /Zero new dependencies/),
    internalReferenceOnly: has(tool, /Internal reference process only/) && has(tool, /Limited, internal review only/),
    productVsInternalDecided: has(analysis, /Decide product vs internal/),
  };
}

/** 纯函数：来源许可登记。 */
export function scanLicenseProvenance(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const analysis = read('.agents/skills/petri-ui-design/references/reference-analysis.md');
  const brief = read('.agents/skills/petri-ui-design/references/design-brief-template.md');
  const entry = ownGet(LICENSE_REGISTER, 'Pinterest/Refero/CTA/Footer') ?? '';
  return {
    licenseSources: Object.keys(LICENSE_REGISTER).length,
    p5Entry: has(entry, /仅评审素材不进产品/),
    recordProvenance: has(analysis, /Record provenance/),
    licenseUnknownGuard: has(analysis, /license_unknown/),
    briefLicenseSection: has(brief, /External references and licenses/),
    licenseRegister: { ...LICENSE_REGISTER },
  };
}

/** 依赖块文本；dependencies 段单独抽出用于计数。 */
const DEP_BLOCK = /"(?:dependencies|devDependencies)"\s*:\s*\{([^{}]*)\}/g;
const depText = (...pkgs) => pkgs.map((t) => (String(t ?? '').match(DEP_BLOCK) || []).join('\n')).join('\n');

/** 纯函数：边界（观感零签 / 零依赖 / 不替换 SimpleChat / 不抄整页 / 不全局换皮）。 */
export function scanBoundaries(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const rootPkg = read('package.json');
  const frontPkg = read('frontend/package.json');
  const noNewDependency = !BRAND_FINGERPRINT.test(depText(rootPkg, frontPkg));
  const ledger = read('docs/ui-productization-audit.md');
  const sections = new Map();
  for (const m of ledger.matchAll(/^## (UI-\d+):[^\n]*(?:\n(?!(?:## |# ))[^\n]*)*/gm)) sections.set(m[1], m[0]);
  const eyeIds = Object.freeze(['UI-706', 'UI-707', 'UI-709', 'UI-710']);
  let humanEyeZeroSign = true;
  for (const id of eyeIds) {
    const sec = sections.get(id) ?? '';
    if (!has(sec, /in_progress/i) || !has(sec, /pending_human_eye/i)
      || has(sec, /\*\*verified\*\*|→\s*\*\*verified\*\*|状态.{0,12}verified/i)) humanEyeZeroSign = false;
  }
  const chatPath = path.join(root, 'frontend/src/components/copilot/SimpleChat.tsx');
  const noSimpleChatReplace = fs.existsSync(chatPath) && !BRAND_FINGERPRINT.test(fs.readFileSync(chatPath, 'utf8'));
  const charter = read('docs/design-charter.md');
  const backlog = read('docs/pending-work-backlog.md');
  return {
    humanEyeZeroSign,
    noNewDependency,
    noSimpleChatReplace,
    noWholePageCopy: has(charter, /学纪律机制，不抄皮肤/) && !has(charter, /照搬整页布局/),
    noGlobalReskin: has(backlog, /不做全局换皮/) && has(backlog, /不把营销 CTA\/Footer 模式照搬进桌面 Agent/),
    licenseRegisterSources: Object.keys(LICENSE_REGISTER).length,
  };
}

/** 完整性校验：任一下限/不变量违约即 ok=false（篡改负测 fail-closed）。 */
export function validateReferenceBoardReviewIntegrity(readings) {
  const issues = [];
  const get = (id) => ownGet(readings ?? {}, id)?.value;
  if (!READING_IDS.every((id) => ownGet(readings ?? {}, id))) {
    return { ok: false, issues: ['读数结构不完整'] };
  }
  const i = get('inspirationBoard');
  if (!i || i.analysisSteps < PATTERN_FLOOR.analysisSteps || !i.observationBorrowSplit
    || !i.designAtomsOnly || !i.pinterestBoardMethod) issues.push('inspirationBoard 违约');
  const d = get('structuredDesignMd');
  if (!d || d.briefSections !== PATTERN_FLOOR.briefSections || !d.briefSkillV110
    || !d.designContextPack || !d.iaMapPresent || !d.referoStructuredMethod) issues.push('structuredDesignMd 违约');
  const m = get('moduleObservation');
  if (!m || m.stateMatrixStates < PATTERN_FLOOR.stateMatrixStates || !m.preDeliveryChecklist
    || !m.ctaActionHierarchy || !m.footerGrouping) issues.push('moduleObservation 违约');
  const r = get('reviewMaterialOnly');
  if (!r || !r.noBrandFingerprint || !r.zeroNewDependencies
    || !r.internalReferenceOnly || !r.productVsInternalDecided) issues.push('reviewMaterialOnly 违约');
  const l = get('licenseProvenance');
  if (!l || l.licenseSources !== PATTERN_FLOOR.licenseSources || !l.p5Entry || !l.recordProvenance
    || !l.licenseUnknownGuard || !l.briefLicenseSection
    || Object.keys(l.licenseRegister ?? {}).length !== PATTERN_FLOOR.licenseSources) issues.push('licenseProvenance 违约');
  const b = get('boundaries');
  if (!b || !b.noNewDependency || !b.noSimpleChatReplace || !b.noWholePageCopy
    || !b.noGlobalReskin || b.licenseRegisterSources !== PATTERN_FLOOR.licenseSources) issues.push('boundaries 违约');
  return { ok: issues.length === 0, issues };
}

/** 纯函数：六组读数汇总，每项带 source/command/capturedAt。违反不变量即抛。 */
export function collectReferenceBoardReview(root = ROOT) {
  const cmd = 'node scripts/c52-reference-board-review.mjs';
  const mk = (value, source) => ({ value, source, command: cmd, capturedAt: 'freeze-invariant' });
  const readings = {
    inspirationBoard: mk(scanInspirationBoard(root), 'petri-ui-design/references/reference-analysis.md + tool-adoption-matrix.md'),
    structuredDesignMd: mk(scanStructuredDesignMd(root), 'design-brief-template.md + design-brief skill.json v1.1.0 + design-context.json + ia-map.json'),
    moduleObservation: mk(scanModuleObservation(root), 'module-state-matrix.md + review-checklist.md + tool-adoption-matrix.md'),
    reviewMaterialOnly: mk(scanReviewMaterialOnly(root), 'frontend/src 全源 + tool-adoption-matrix.md 默认决策 + reference-analysis.md Step5'),
    licenseProvenance: mk(scanLicenseProvenance(root), 'LICENSE_REGISTER + reference-analysis.md Step4 + design-brief-template.md §9'),
    boundaries: mk(scanBoundaries(root), '根/前端 package.json + UI 台账 + SimpleChat.tsx + design-charter.md + backlog'),
  };
  const check = validateReferenceBoardReviewIntegrity(readings);
  if (!check.ok) throw new Error(`[c52:review-board] 读数不合格: ${check.issues.join('; ')}`);
  return readings;
}

const sourceCommitOf = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function main(argv) {
  const readings = collectReferenceBoardReview(ROOT);
  const check = validateReferenceBoardReviewIntegrity(readings);
  if (!check.ok) {
    console.error(`[c52:review-board] 读数不合格，拒绝写盘: ${check.issues.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const sourceCommit = sourceCommitOf(ROOT);
  const snapPath = path.join(ROOT, 'acceptance/block481-c52-p5-reference-board-review/reference-board-review-snapshot.json');
  const contractPath = path.join(ROOT, 'resources/design-context/reference-board-review.json');
  const manifestPath = path.join(ROOT, 'resources/design-context/manifest.json');

  if (argv.includes('--check')) {
    if (!fs.existsSync(snapPath)) { console.error('[c52:review-board] 快照缺席，请先生成'); process.exitCode = 1; return; }
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    for (const id of READING_IDS) {
      try { deepStrictEqual(ownGet(readings, id).value, ownGet(snap.readings, id).value); }
      catch { console.error(`[c52:review-board] --check 漂移: ${id}`); process.exitCode = 1; return; }
    }
    console.log(JSON.stringify({ ok: true, sourceCommit, readingIds: READING_IDS }, null, 2));
    return;
  }

  const frozenReadings = Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id)]));
  const snapshot = {
    schemaVersion: 1,
    kind: 'c52-reference-board-review',
    capability: 'block481-c52-p5-reference-board-review',
    sourceCommit,
    platform: `${os.platform()}-${os.arch()}`,
    command: 'node scripts/c52-reference-board-review.mjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'mechanical-gate',
    verdict: 'measured',
    humanEyeEquivalent: false,
    note: '读数=机械不变量（冻结，消费测试逐读数深等）；仅 Pinterest/Refero/CTA/Footer 参考板与评审法模式借鉴+契约冻结，仅评审素材不进产品，观感 pending_human_eye 不代签，零 UI 运行时写面。',
    readings: frozenReadings,
  };
  const contract = {
    schemaVersion: 1,
    id: 'petri-reference-board-review-contract',
    kind: 'model-readable-reference-board-review',
    generatedBy: 'node scripts/c52-reference-board-review.mjs',
    sourceCommit,
    generatedAt: new Date().toISOString(),
    derivedFrom: [
      '.agents/skills/petri-ui-design/references/reference-analysis.md（Pinterest 灵感画板五步法 + 观察/借鉴分离 + 只取设计原子）',
      '.agents/skills/petri-ui-design/references/design-brief-template.md + resources/skills/design-brief（Refero DESIGN.md 结构化十节 + Skill v1.1.0）',
      '.agents/skills/petri-ui-design/references/module-state-matrix.md + review-checklist.md（CTA/Footer 模块级八态观察 + 交付前评审）',
      'resources/design-context/design-context.json + ia-map.json（模型可读设计输入与 IA 映射）',
      'LICENSE_REGISTER 四来源登记 + docs/design-charter.md（不抄皮肤立场）+ docs/ui-productization-audit.md（观感零签）',
    ],
    patterns: Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id).value])),
    boundaries: {
      humanEyeSigned: false,
      readOnly: true,
      noBrandCopy: true,
      reviewMaterialOnly: true,
      fullPageCopy: false,
      noGlobalReskin: true,
      newProductDependency: false,
      note: '参考板与评审法只做评审方法借鉴与契约冻结：仅评审素材不进产品，不复制品牌标志/文案/插画/整页布局，不照搬营销 CTA-Footer 模式、不做全局换皮；观感项 pending_human_eye 保持 in_progress，Agent 不代签。',
    },
  };

  const contractBuf = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  for (const p of [snapPath, contractPath, manifestPath]) fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(snapPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(contractPath, contractBuf);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const sha = createHash('sha256').update(contractBuf).digest('hex');
  const entry = files.find((f) => ownGet(f, 'path') === 'reference-board-review.json');
  if (entry) entry.sha256 = sha;
  else files.push({ path: 'reference-board-review.json', sha256: sha });
  manifest.files = files;
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    written: [snapPath, contractPath, manifestPath].map((p) => path.relative(ROOT, p)),
    sourceCommit,
    readingIds: READING_IDS,
    analysisSteps: ownGet(readings, 'inspirationBoard').value.analysisSteps,
    briefSections: ownGet(readings, 'structuredDesignMd').value.briefSections,
    stateMatrixStates: ownGet(readings, 'moduleObservation').value.stateMatrixStates,
    licenseSources: ownGet(readings, 'licenseProvenance').value.licenseSources,
    humanEyeZeroSign: ownGet(readings, 'boundaries').value.humanEyeZeroSign,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
