#!/usr/bin/env node
/**
 * scripts/c52-21st-snippet-library.mjs — BLOCK-480 / C-52 P4（21st.dev 组件/模板片段灵感库）模式借鉴契约冻结扫描。
 *
 * collect21stSnippetLibrary(root) 是纯函数：从 canonical 真源机械复算六组读数，不写产品代码。
 * C-52 P4 只做 21st.dev 的「模式借鉴 + 契约冻结」——Petri 已有本地主权控件单源，
 * 逐组件查许可、只作参考片段、防风格漂移、防依赖膨胀，零新增产品依赖、不复制品牌资产、
 * 观感 pending_human_eye 零代签。
 *   - snippetInventory      本地控件片段清单（button 单源变体 / status 三态 / 宪章五件套 / 按钮棘轮守卫）
 *   - licenseAudit         逐组件许可（四来源许可证登记 / 21st.dev 逐组件查许可条款）
 *   - referenceOnly        只参考不搬（无 UI kit 片段指纹 / 无外链 CDN import / 宪章不抄皮肤）
 *   - styleDriftGuard      防风格漂移（海军蓝四档规范 / 宪章七节 / 颜色+按钮棘轮守卫）
 *   - dependencyBloatGuard 防依赖膨胀（零 UI kit 依赖 / 前端依赖数冻结上限 / 无 CLI 依赖）
 *   - boundaries           边界（观感零签 / 零依赖 / 不替换 SimpleChat / 四来源许可证 / 不抄整页布局）
 * 同一批读数派生 acceptance 快照与 resources/design-context/21st-snippet-library.json
 * ——模型可读、可复算，被 test/c52-21st-snippet-library.test.mjs 锚定。
 *
 * 用法：node scripts/c52-21st-snippet-library.mjs            # 写快照+契约+manifest
 *       node scripts/c52-21st-snippet-library.mjs --check    # 只重算并与落盘 value 比对
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
  'snippetInventory', 'licenseAudit', 'referenceOnly',
  'styleDriftGuard', 'dependencyBloatGuard', 'boundaries',
]);

/** 冻结下限（只减必红）：现读锚点数/档数/许可证来源数/依赖上限。 */
export const PATTERN_FLOOR = Object.freeze({
  controlVariantClasses: 6,
  licenseSources: 4,
  charterSections: 7,
  frontendDependencyCeiling: 45,
  owner: 'BLOCK-480 / C-52 P4：立项现读 2026-11-18；21st.dev 片段灵感库借鉴+契约冻结；逐组件查许可/仅参考不搬/防风格漂移/防依赖膨胀/观感零代签',
});

/** 海军蓝暗色四档规范值（petri-css-theme §1 / custom.css dark 块；与 C-53 P3 视觉一致性同源冻结）。 */
const NAVY_SPEC = Object.freeze(['#0b1220', '#111a2e', '#182339', '#1d2945']);
const NAVY_TIER_KEYS = Object.freeze(['canvas', 'surface', 'subtle', 'elevated']);

/** UI kit / 片段来源指纹（ wicked 引入即红；infima 是既有基线不在内）。 */
const UI_KIT_FINGERPRINT = /(?:21st(?:\.dev)?|shadcn|magicui|aceternity|@radix-ui|framer-motion|assistant-ui|react-bits)/i;

/** 许可证与来源登记（只记录、不引入依赖、不复制品牌资产）。与 C-52 P2/P3 同源冻结。 */
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

/** 纯函数：本地控件片段清单。 */
export function scanSnippetInventory(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const button = read('frontend/src/components/ui/controls/button.module.css');
  const status = read('frontend/src/components/ui/controls/status.module.css');
  const charter = read('docs/design-charter.md');
  const contract = read('frontend/src/styles/theme-token-contract.test.ts');
  return {
    controlVariantClasses: count(button, /^\.[A-Za-z][\w-]*\s*\{/gm),
    composesSingleSource: has(button, /composes:\s*base/),
    statusTriad: has(status, /\.errorNotice/) && has(status, /\.loading/) && has(status, /\.spinner/),
    charterFiveKinds: has(charter, /Button\/Input\/Select\/Chip\/Empty 五件套/),
    buttonRatchetGuard: has(contract, /button class definitions hold the frozen inventory/),
  };
}

/** 纯函数：逐组件许可审计（许可证登记为模块内冻结常量，不依赖 root/注入源）。 */
export function scanLicenseAudit(_root = ROOT, _sourcesOverride = null) {
  const entry = ownGet(LICENSE_REGISTER, '21st.dev') ?? '';
  return {
    licenseSources: Object.keys(LICENSE_REGISTER).length,
    perComponentLicense: has(entry, /逐组件查许可/),
    referenceOnlyClause: has(entry, /仅组件\/模板片段灵感/),
    licenseRegister: { ...LICENSE_REGISTER },
  };
}

/** 纯函数：只参考不搬（前端源零 UI kit 片段指纹 / 零外链 CDN import / 宪章不抄皮肤）。 */
export function scanReferenceOnly(root = ROOT, sourcesOverride = null) {
  let noExternalSnippetImport = true;
  let noCdnImport = true;
  for (const text of frontendSources(root, sourcesOverride).values()) {
    if (UI_KIT_FINGERPRINT.test(text)) noExternalSnippetImport = false;
    if (/@import\s+url\(['"]?https?:/i.test(text)) noCdnImport = false;
  }
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const charter = read('docs/design-charter.md');
  return {
    noExternalSnippetImport,
    noCdnImport,
    charterNoSkinCopy: has(charter, /学纪律机制，不抄皮肤/),
  };
}

/** 纯函数：海军蓝四档规范对齐（dark 块取最后一次定义，与 C-53 P3 同口径）。 */
function navySpecAligned(customCss) {
  const text = String(customCss ?? '');
  return NAVY_TIER_KEYS.every((key, i) => {
    const hits = [...text.matchAll(new RegExp(`--petri-bg-${key}:\\s*(#[0-9a-fA-F]{6})`, 'g'))];
    const hex = hits.length ? hits[hits.length - 1][1] : null;
    return hex && hex.toLowerCase() === NAVY_SPEC.at(i);
  });
}

/** 纯函数：防风格漂移。 */
export function scanStyleDriftGuard(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const custom = read('frontend/src/styles/custom.css');
  const charter = read('docs/design-charter.md');
  const contract = read('frontend/src/styles/theme-token-contract.test.ts');
  return {
    navySpecAligned: navySpecAligned(custom),
    charterSections: count(charter, /^## [0-9]+\./gm),
    colorRatchetGuard: has(contract, /raw-color var\(\) fallbacks beyond the frozen ratchet/),
    buttonRatchetGuard: has(contract, /button class definitions hold the frozen inventory/),
  };
}

/** 依赖块文本；dependencies 段单独抽出用于计数（兼容单行注入源与多行真实源）。 */
const DEP_BLOCK = /"(?:dependencies|devDependencies)"\s*:\s*\{([^{}]*)\}/g;
const DEPENDENCIES_BLOCK = /"dependencies"\s*:\s*\{([^{}]*)\}/;
const depText = (...pkgs) => pkgs.map((t) => (String(t ?? '').match(DEP_BLOCK) || []).join('\n')).join('\n');

/** 纯函数：防依赖膨胀。 */
export function scanDependencyBloatGuard(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const rootPkg = read('package.json');
  const frontPkg = read('frontend/package.json');
  const deps = depText(rootPkg, frontPkg);
  const frontDepBlock = (String(frontPkg).match(DEPENDENCIES_BLOCK) || [])[1] ?? '';
  return {
    noUiKitDependency: !UI_KIT_FINGERPRINT.test(deps),
    frontendDependencyCount: count(frontDepBlock, /"[^"]+"\s*:/g),
    noCliDependency: !/(?:shadcn|21st(?:-cli|\.dev\/cli)|create-21st)/i.test(deps),
  };
}

/** 纯函数：边界（观感零签 / 零依赖 / 不替换 SimpleChat / 四来源许可证 / 不抄整页布局）。 */
export function scanBoundaries(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const rootPkg = read('package.json');
  const frontPkg = read('frontend/package.json');
  const noNewDependency = !UI_KIT_FINGERPRINT.test(depText(rootPkg, frontPkg));
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
  const noSimpleChatReplace = fs.existsSync(chatPath) && !UI_KIT_FINGERPRINT.test(fs.readFileSync(chatPath, 'utf8'));
  const charter = read('docs/design-charter.md');
  return {
    humanEyeZeroSign,
    noNewDependency,
    noSimpleChatReplace,
    licenseRegister: { ...LICENSE_REGISTER },
    noFullPageCopy: has(charter, /不抄皮肤/) && !has(charter, /照搬整页布局/),
  };
}

/** 完整性校验：任一下限/不变量违约即 ok=false（篡改负测 fail-closed）。 */
export function validate21stSnippetLibraryIntegrity(readings) {
  const issues = [];
  const get = (id) => ownGet(readings ?? {}, id)?.value;
  if (!READING_IDS.every((id) => ownGet(readings ?? {}, id))) {
    return { ok: false, issues: ['读数结构不完整'] };
  }
  const s = get('snippetInventory');
  if (!s || s.controlVariantClasses < PATTERN_FLOOR.controlVariantClasses || !s.composesSingleSource
    || !s.statusTriad || !s.charterFiveKinds || !s.buttonRatchetGuard) issues.push('snippetInventory 违约');
  const a = get('licenseAudit');
  if (!a || a.licenseSources !== PATTERN_FLOOR.licenseSources || !a.perComponentLicense
    || !a.referenceOnlyClause || Object.keys(a.licenseRegister ?? {}).length !== PATTERN_FLOOR.licenseSources) {
    issues.push('licenseAudit 违约');
  }
  const r = get('referenceOnly');
  if (!r || !r.noExternalSnippetImport || !r.noCdnImport || !r.charterNoSkinCopy) issues.push('referenceOnly 违约');
  const g = get('styleDriftGuard');
  if (!g || !g.navySpecAligned || g.charterSections < PATTERN_FLOOR.charterSections
    || !g.colorRatchetGuard || !g.buttonRatchetGuard) issues.push('styleDriftGuard 违约');
  const d = get('dependencyBloatGuard');
  if (!d || !d.noUiKitDependency || d.frontendDependencyCount > PATTERN_FLOOR.frontendDependencyCeiling
    || !d.noCliDependency) issues.push('dependencyBloatGuard 违约');
  const b = get('boundaries');
  if (!b || !b.humanEyeZeroSign || !b.noNewDependency || !b.noSimpleChatReplace || !b.noFullPageCopy
    || Object.keys(b.licenseRegister ?? {}).length !== PATTERN_FLOOR.licenseSources) issues.push('boundaries 违约');
  return { ok: issues.length === 0, issues };
}

/** 纯函数：六组读数汇总，每项带 source/command/capturedAt。违反不变量即抛。 */
export function collect21stSnippetLibrary(root = ROOT) {
  const cmd = 'node scripts/c52-21st-snippet-library.mjs';
  const mk = (value, source) => ({ value, source, command: cmd, capturedAt: 'freeze-invariant' });
  const readings = {
    snippetInventory: mk(scanSnippetInventory(root), 'controls/button.module.css + status.module.css + design-charter.md §6 + theme-token-contract.test.ts'),
    licenseAudit: mk(scanLicenseAudit(root), 'LICENSE_REGISTER（四来源许可证登记）'),
    referenceOnly: mk(scanReferenceOnly(root), 'frontend/src 全源 + design-charter.md 立场'),
    styleDriftGuard: mk(scanStyleDriftGuard(root), 'custom.css dark 块 + design-charter.md + theme-token-contract.test.ts'),
    dependencyBloatGuard: mk(scanDependencyBloatGuard(root), '根/前端 package.json 依赖块'),
    boundaries: mk(scanBoundaries(root), '根/前端 package.json + UI 台账 + SimpleChat.tsx + LICENSE_REGISTER'),
  };
  const check = validate21stSnippetLibraryIntegrity(readings);
  if (!check.ok) throw new Error(`[c52:snippets] 读数不合格: ${check.issues.join('; ')}`);
  return readings;
}

const sourceCommitOf = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function main(argv) {
  const readings = collect21stSnippetLibrary(ROOT);
  const check = validate21stSnippetLibraryIntegrity(readings);
  if (!check.ok) {
    console.error(`[c52:snippets] 读数不合格，拒绝写盘: ${check.issues.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const sourceCommit = sourceCommitOf(ROOT);
  const snapPath = path.join(ROOT, 'acceptance/block480-c52-p4-21st-snippet-library/21st-snippet-library-snapshot.json');
  const contractPath = path.join(ROOT, 'resources/design-context/21st-snippet-library.json');
  const manifestPath = path.join(ROOT, 'resources/design-context/manifest.json');

  if (argv.includes('--check')) {
    if (!fs.existsSync(snapPath)) { console.error('[c52:snippets] 快照缺席，请先生成'); process.exitCode = 1; return; }
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    for (const id of READING_IDS) {
      try { deepStrictEqual(ownGet(readings, id).value, ownGet(snap.readings, id).value); }
      catch { console.error(`[c52:snippets] --check 漂移: ${id}`); process.exitCode = 1; return; }
    }
    console.log(JSON.stringify({ ok: true, sourceCommit, readingIds: READING_IDS }, null, 2));
    return;
  }

  const frozenReadings = Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id)]));
  const snapshot = {
    schemaVersion: 1,
    kind: 'c52-21st-snippet-library',
    capability: 'block480-c52-p4-21st-snippet-library',
    sourceCommit,
    platform: `${os.platform()}-${os.arch()}`,
    command: 'node scripts/c52-21st-snippet-library.mjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'mechanical-gate',
    verdict: 'measured',
    humanEyeEquivalent: false,
    note: '读数=机械不变量（冻结，消费测试逐读数深等）；仅 21st.dev 片段灵感库模式借鉴+契约冻结，逐组件查许可/仅参考不搬/防风格漂移/防依赖膨胀，观感 pending_human_eye 不代签，零 UI 运行时写面。',
    readings: frozenReadings,
  };
  const contract = {
    schemaVersion: 1,
    id: 'petri-21st-snippet-library-contract',
    kind: 'model-readable-21st-snippet-library',
    generatedBy: 'node scripts/c52-21st-snippet-library.mjs',
    sourceCommit,
    generatedAt: new Date().toISOString(),
    derivedFrom: [
      'components/ui/controls/button.module.css + status.module.css（本地主权控件片段单源）',
      'docs/design-charter.md §1–§6（字号/色彩/线条/动效/渲染/控件 + 不抄皮肤立场）',
      'frontend/src/styles/theme-token-contract.test.ts（颜色/按钮清单棘轮守卫）',
      'resources/design-context/manifest.json 同源四来源许可证登记（LICENSE_REGISTER）',
      '根/前端 package.json（零 UI kit 依赖）+ docs/ui-productization-audit.md（观感零签）',
    ],
    patterns: Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id).value])),
    boundaries: {
      humanEyeSigned: false,
      readOnly: true,
      noBrandCopy: true,
      fullPageCopy: false,
      newProductDependency: false,
      note: '21st.dev 组件/模板片段只做灵感与契约冻结：逐组件查许可、仅作参考片段、防风格漂移、防依赖膨胀，不复制品牌标志/文案/插画/整页布局；观感项 pending_human_eye 保持 in_progress，Agent 不代签。',
    },
  };

  const contractBuf = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  for (const p of [snapPath, contractPath, manifestPath]) fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(snapPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(contractPath, contractBuf);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const sha = createHash('sha256').update(contractBuf).digest('hex');
  const entry = files.find((f) => ownGet(f, 'path') === '21st-snippet-library.json');
  if (entry) entry.sha256 = sha;
  else files.push({ path: '21st-snippet-library.json', sha256: sha });
  manifest.files = files;
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    written: [snapPath, contractPath, manifestPath].map((p) => path.relative(ROOT, p)),
    sourceCommit,
    readingIds: READING_IDS,
    controlVariantClasses: ownGet(readings, 'snippetInventory').value.controlVariantClasses,
    navySpecAligned: ownGet(readings, 'styleDriftGuard').value.navySpecAligned,
    licenseSources: ownGet(readings, 'licenseAudit').value.licenseSources,
    humanEyeZeroSign: ownGet(readings, 'boundaries').value.humanEyeZeroSign,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
