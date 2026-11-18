#!/usr/bin/env node
/**
 * scripts/c52-react-bits-motion.mjs — BLOCK-479 / C-52 P3（React Bits 反馈型微动效）模式借鉴契约冻结扫描。
 *
 * collectReactBitsMotion(root) 是纯函数：从 canonical 真源机械复算六组读数，不写产品代码。
 * C-52 P3 只做 React Bits 四类反馈型微动效的「模式借鉴 + 契约冻结」——Petri 已有本地主权
 * 动效锚点，复用 --petri-duration/ease token，零新增产品依赖、禁整页动效、观感 pending_human_eye 零代签。
 *   - hoverFeedback    悬停反馈（token 驱动过渡 + 基线控件 :hover 态）
 *   - pressFeedback    按压反馈（:active transform scale + token 驱动过渡）
 *   - expandFeedback   展开反馈（三处功能性布局过渡宿主 + reduced-motion 豁免）
 *   - successFeedback  成功反馈（toast success 语义色 + spinner token + 全局 reduced-motion 兜底）
 *   - motionTokens     token 复用（三档 duration / 两档 ease / 宪章对齐 / 单调+字面量守卫）
 *   - boundaries       边界（零新增依赖 / 禁整页动效 / 观感零签 / 许可证来源登记）
 * 同一批读数派生 acceptance 快照与 resources/design-context/react-bits-motion.json
 * ——模型可读、可复算，被 test/c52-react-bits-motion.test.mjs 锚定。
 *
 * 用法：node scripts/c52-react-bits-motion.mjs            # 写快照+契约+manifest
 *       node scripts/c52-react-bits-motion.mjs --check    # 只重算并与落盘 value 比对
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
  'hoverFeedback', 'pressFeedback', 'expandFeedback',
  'successFeedback', 'motionTokens', 'boundaries',
]);

/** 冻结下限（只减必红）：现读锚点数、档数、许可证来源数。 */
export const PATTERN_FLOOR = Object.freeze({
  hoverAnchors: 6,
  activeAnchors: 4,
  functionalOwners: 3,
  durationTiers: 3,
  easeTiers: 2,
  tokenUses: 150,
  licenseSources: 4,
  owner: 'BLOCK-479 / C-52 P3：立项现读 2026-11-18；反馈型微动效模式借鉴+契约冻结；零依赖/禁整页动效/复用 duration-ease token/观感零代签',
});

/** 许可证与来源登记（只记录、不引入依赖、不复制品牌资产）。与 C-52 P2 同源冻结。 */
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

/** 纯函数：hover 反馈形态（sourcesOverride 为 {rel:text} 映射，测试注入用）。 */
export function scanHoverFeedback(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const button = read('frontend/src/components/ui/controls/button.module.css');
  const titleBar = read('frontend/src/components/desktop/TitleBar.module.css');
  const toast = read('frontend/src/components/common/ToastProvider.module.css');
  const resizer = read('frontend/src/components/workspace-panels/FloatCardResizer.module.css');
  const hoverAnchors = count(button, /:hover/g) + count(titleBar, /:hover/g)
    + count(toast, /:hover/g) + count(resizer, /:hover/g);
  return {
    tokenDrivenHover: has(button, /transition:[^;]*var\(--petri-duration/),
    hoverStateBaseline: has(titleBar, /\.winBtn:hover/) && has(toast, /\.dismiss:hover/),
    hoverAnchors,
  };
}

/** 纯函数：press 反馈形态。 */
export function scanPressFeedback(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const titleBar = read('frontend/src/components/desktop/TitleBar.module.css');
  const chat = read('frontend/src/components/copilot/simple-chat.css');
  const resizer = read('frontend/src/components/workspace-panels/FloatCardResizer.module.css');
  const activeAnchors = count(titleBar, /:active/g) + count(chat, /:active/g) + count(resizer, /:active/g);
  return {
    activeScale: has(titleBar, /:active\s*\{[^}]*transform:\s*scale\(/),
    tokenDrivenPress: has(titleBar, /transform var\(--petri-duration/),
    activeAnchors,
  };
}

/** 纯函数：expand 反馈形态（功能性布局过渡宿主 + reduced-motion 豁免）。 */
export function scanExpandFeedback(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const global = read('frontend/src/styles/global.css');
  const hosts = [
    'frontend/src/components/workspace-panels/LeftPanel.tsx',
    'frontend/src/components/workspace-panels/RightPanel.tsx',
    'frontend/src/components/workspace-panels/BottomTerminal.tsx',
  ];
  let functionalOwners = 0;
  for (const rel of hosts) {
    if (has(read(rel), /data-petri-motion=['"]functional['"]/)) functionalOwners += 1;
  }
  return {
    functionalOwners,
    reducedMotionExemption: has(global, /\[data-petri-motion=['"]functional['"]\]/)
      && has(global, /prefers-reduced-motion:\s*reduce/),
    tokenDrivenExpand: has(global, /\[data-petri-motion=['"]functional['"]\][\s\S]{0,200}--petri-duration-base/),
  };
}

/** 纯函数：success 反馈形态（成功语义色 + spinner token + 全局 reduced-motion 兜底）。 */
export function scanSuccessFeedback(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const toast = read('frontend/src/components/common/ToastProvider.module.css');
  const status = read('frontend/src/components/ui/controls/status.module.css');
  const global = read('frontend/src/styles/global.css');
  return {
    toastSuccessVariant: has(toast, /\[data-variant=['"]success['"]\]/) && has(toast, /var\(--petri-success\)/),
    spinnerToken: has(status, /animation:\s*spin var\(--petri-duration-slow\)/),
    reducedMotionFallback: has(global, /html\[data-motion=['"]reduced['"]\]\s\*/)
      && has(global, /animation-duration:\s*0\.001ms/),
  };
}

/** 递归遍历前端源（与 theme-token-contract CSS_FILES() 同口径）。 */
function walkFrontend(root) {
  const base = path.join(root, 'frontend/src');
  const out = [];
  const walk = (dir) => {
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

/** 纯函数：motion token 复用形态（sourcesOverride 影响 custom.css / charter / 契约测试读数）。 */
export function scanMotionTokens(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const custom = read('frontend/src/styles/custom.css');
  const charter = read('docs/design-charter.md');
  const contract = read('frontend/src/styles/theme-token-contract.test.ts');
  const durationTiers = count(custom, /--petri-duration-(?:fast|base|slow)\s*:/g);
  const easeTiers = count(custom, /--petri-ease-(?:standard|emphasized)\s*:/g);
  let tokenUses = 0;
  for (const file of walkFrontend(root)) {
    tokenUses += count(fs.readFileSync(file, 'utf8'), /var\(--petri-duration-(?:fast|base|slow)\)/g);
  }
  return {
    durationTiers,
    easeTiers,
    charterAligned: has(charter, /150\/200\/300ms/)
      && has(charter, /--petri-ease-standard/)
      && has(charter, /--petri-ease-emphasized/),
    monotonicGuard: has(contract, /duration\(['"]--petri-duration-fast['"]\)\)\.toBeLessThan\(duration\(['"]--petri-duration-base['"]\)\)/)
      && has(contract, /toBeLessThan\(duration\(['"]--petri-duration-slow['"]\)\)/),
    literalMsGuard: has(contract, /LITERAL_TIME/) && has(contract, /expect\(offenders\.filter/),
    tokenUses,
  };
}

/** 纯函数：边界（零依赖 / 禁整页动效 / 观感零签 / 许可证登记）。 */
export function scanBoundaries(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const rootPkg = read('package.json');
  const frontPkg = read('frontend/package.json');
  const global = read('frontend/src/styles/global.css');
  const depBlock = (t) => (String(t ?? '').match(/"(?:dependencies|devDependencies)"\s*:\s*\{([\s\S]*?)\}/g) || []).join('\n');
  const depText = `${depBlock(rootPkg)}\n${depBlock(frontPkg)}`;
  const noNewDependency = !has(depText, /react-bits/) && !has(depText, /framer-motion/)
    && !has(depText, /assistant-ui/) && !has(depText, /21st/);
  const noFullPageMotion = has(global, /html\[data-motion=['"]reduced['"]\]\s\*/)
    && has(global, /animation-iteration-count:\s*1/)
    && has(global, /animation-duration:\s*0\.001ms/);
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
    noFullPageMotion,
    humanEyeZeroSign,
    licenseRegister: { ...LICENSE_REGISTER },
  };
}

/** 完整性校验：任一下限/不变量违约即 ok=false（篡改负测 fail-closed）。 */
export function validateReactBitsMotionIntegrity(readings) {
  const issues = [];
  const get = (id) => ownGet(readings ?? {}, id)?.value;
  if (!READING_IDS.every((id) => ownGet(readings ?? {}, id))) {
    return { ok: false, issues: ['读数结构不完整'] };
  }
  const h = get('hoverFeedback');
  if (!h || !h.tokenDrivenHover || !h.hoverStateBaseline
    || h.hoverAnchors < PATTERN_FLOOR.hoverAnchors) issues.push('hoverFeedback 违约');
  const p = get('pressFeedback');
  if (!p || !p.activeScale || !p.tokenDrivenPress
    || p.activeAnchors < PATTERN_FLOOR.activeAnchors) issues.push('pressFeedback 违约');
  const e = get('expandFeedback');
  if (!e || e.functionalOwners < PATTERN_FLOOR.functionalOwners || !e.reducedMotionExemption
    || !e.tokenDrivenExpand) issues.push('expandFeedback 违约');
  const s = get('successFeedback');
  if (!s || !s.toastSuccessVariant || !s.spinnerToken || !s.reducedMotionFallback) {
    issues.push('successFeedback 违约');
  }
  const m = get('motionTokens');
  if (!m || m.durationTiers !== PATTERN_FLOOR.durationTiers || m.easeTiers !== PATTERN_FLOOR.easeTiers
    || !m.charterAligned || !m.monotonicGuard || !m.literalMsGuard
    || m.tokenUses < PATTERN_FLOOR.tokenUses) issues.push('motionTokens 违约');
  const b = get('boundaries');
  if (!b || !b.noNewDependency || !b.noFullPageMotion || !b.humanEyeZeroSign
    || Object.keys(b.licenseRegister ?? {}).length !== PATTERN_FLOOR.licenseSources) {
    issues.push('boundaries 违约');
  }
  return { ok: issues.length === 0, issues };
}

/** 纯函数：六组读数汇总，每项带 source/command/capturedAt。违反不变量即抛。 */
export function collectReactBitsMotion(root = ROOT) {
  const cmd = 'node scripts/c52-react-bits-motion.mjs';
  const mk = (value, source) => ({ value, source, command: cmd, capturedAt: 'freeze-invariant' });
  const readings = {
    hoverFeedback: mk(scanHoverFeedback(root), 'button.module.css + TitleBar.module.css + ToastProvider.module.css + FloatCardResizer.module.css'),
    pressFeedback: mk(scanPressFeedback(root), 'TitleBar.module.css + simple-chat.css + FloatCardResizer.module.css'),
    expandFeedback: mk(scanExpandFeedback(root), 'LeftPanel/RightPanel/BottomTerminal + global.css（reduced-motion 豁免）'),
    successFeedback: mk(scanSuccessFeedback(root), 'ToastProvider.module.css + status.module.css + global.css'),
    motionTokens: mk(scanMotionTokens(root), 'custom.css + design-charter.md §4 + theme-token-contract.test.ts'),
    boundaries: mk(scanBoundaries(root), '根/前端 package.json + global.css + UI 台账 + LICENSE_REGISTER'),
  };
  const check = validateReactBitsMotionIntegrity(readings);
  if (!check.ok) throw new Error(`[c52:motion] 读数不合格: ${check.issues.join('; ')}`);
  return readings;
}

const sourceCommitOf = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function main(argv) {
  const readings = collectReactBitsMotion(ROOT);
  const check = validateReactBitsMotionIntegrity(readings);
  if (!check.ok) {
    console.error(`[c52:motion] 读数不合格，拒绝写盘: ${check.issues.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const sourceCommit = sourceCommitOf(ROOT);
  const snapPath = path.join(ROOT, 'acceptance/block479-c52-p3-react-bits-motion/react-bits-motion-snapshot.json');
  const contractPath = path.join(ROOT, 'resources/design-context/react-bits-motion.json');
  const manifestPath = path.join(ROOT, 'resources/design-context/manifest.json');

  if (argv.includes('--check')) {
    if (!fs.existsSync(snapPath)) { console.error('[c52:motion] 快照缺席，请先生成'); process.exitCode = 1; return; }
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    for (const id of READING_IDS) {
      try { deepStrictEqual(ownGet(readings, id).value, ownGet(snap.readings, id).value); }
      catch { console.error(`[c52:motion] --check 漂移: ${id}`); process.exitCode = 1; return; }
    }
    console.log(JSON.stringify({ ok: true, sourceCommit, readingIds: READING_IDS }, null, 2));
    return;
  }

  const frozenReadings = Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id)]));
  const snapshot = {
    schemaVersion: 1,
    kind: 'c52-react-bits-motion',
    capability: 'block479-c52-p3-react-bits-motion',
    sourceCommit,
    platform: `${os.platform()}-${os.arch()}`,
    command: 'node scripts/c52-react-bits-motion.mjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'mechanical-gate',
    verdict: 'measured',
    humanEyeEquivalent: false,
    note: '读数=机械不变量（冻结，消费测试逐读数深等）；仅反馈型微动效模式借鉴+契约冻结，观感 pending_human_eye 不代签，零 UI 运行时写面。',
    readings: frozenReadings,
  };
  const contract = {
    schemaVersion: 1,
    id: 'petri-react-bits-motion-contract',
    kind: 'model-readable-react-bits-motion',
    generatedBy: 'node scripts/c52-react-bits-motion.mjs',
    sourceCommit,
    generatedAt: new Date().toISOString(),
    derivedFrom: [
      'button.module.css + TitleBar.module.css + ToastProvider.module.css + FloatCardResizer.module.css（hover 悬停反馈）',
      'TitleBar.module.css + simple-chat.css + FloatCardResizer.module.css（:active 按压反馈）',
      'LeftPanel/RightPanel/BottomTerminal + global.css（功能性布局过渡 + reduced-motion 豁免）',
      'ToastProvider.module.css + status.module.css + global.css（成功语义色 + spinner + 兜底）',
      'custom.css + design-charter.md §4 + theme-token-contract.test.ts（duration/ease token 复用）',
    ],
    patterns: Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id).value])),
    boundaries: {
      humanEyeSigned: false,
      readOnly: true,
      fullPageMotion: false,
      newProductDependency: false,
      note: '四类反馈型微动效只做本地主权形态借鉴与契约冻结，复用 --petri-duration/ease token，禁整页动效、不新增产品依赖；观感项 pending_human_eye 保持 in_progress，Agent 不代签。',
    },
  };

  const contractBuf = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  for (const p of [snapPath, contractPath, manifestPath]) fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(snapPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(contractPath, contractBuf);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const sha = createHash('sha256').update(contractBuf).digest('hex');
  const entry = files.find((f) => ownGet(f, 'path') === 'react-bits-motion.json');
  if (entry) entry.sha256 = sha;
  else files.push({ path: 'react-bits-motion.json', sha256: sha });
  manifest.files = files;
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    written: [snapPath, contractPath, manifestPath].map((p) => path.relative(ROOT, p)),
    sourceCommit,
    readingIds: READING_IDS,
    hoverAnchors: ownGet(readings, 'hoverFeedback').value.hoverAnchors,
    activeAnchors: ownGet(readings, 'pressFeedback').value.activeAnchors,
    tokenUses: ownGet(readings, 'motionTokens').value.tokenUses,
    humanEyeZeroSign: ownGet(readings, 'boundaries').value.humanEyeZeroSign,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
