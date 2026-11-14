#!/usr/bin/env node
/**
 * UI-D0 (BLOCK-415) — 对账基线机械门。
 *
 * 唯一职责：把 acceptance/ui-design-assessment-2026-11-11/baseline.json
 * 与同目录 ASSESSMENT-AND-PLAN.md 的 §0 评分卡 / §1 量化基线逐字段锁在一起。
 * 后续 D1–D5 的收敛量以本门冻结的字段为准，防止「分数不可比」与「基线被悄悄改写」。
 *
 * 只减不增纪律：本门不放宽任何阈值；新增顶层字段（未登记）即红。
 * 用法：node scripts/ui-design-baseline.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_PATH = path.join(ROOT, 'acceptance/ui-design-assessment-2026-11-11/baseline.json');
export const PLAN_PATH = path.join(ROOT, 'acceptance/ui-design-assessment-2026-11-11/ASSESSMENT-AND-PLAN.md');
export const BASELINE_SCHEMA = 'petri.ui-design.baseline.v1';

/** 顶层键白名单：植入未登记顶层字段即红（防止第二真相/私有扩展悄悄入场）。 */
export const TOP_LEVEL_KEYS = [
  'schema', 'capturedAt', 'evidenceLevel', 'notIncluded', 'scope', 'scale',
  'visualDebt', 'gates', 'uiLedger', 'toolchain', 'staticScores',
  'installedSkills', 'decisionAdvisors', 'plan',
];

/**
 * 每个契约：从报告 Markdown 表格里按「行首锚」找到唯一一行，取第 2 列，
 * 断言该列按出现顺序含有 baseline 对应字段的数值。
 * path 为 baseline 内的点路径；anchor 为该行第 1 列的唯一子串。
 */
export const FIELD_CONTRACTS = [
  { section: '1', anchor: '`.tsx` / `.ts`', paths: ['scale.tsx', 'scale.ts'] },
  { section: '1', anchor: 'CSS 总数', paths: ['scale.cssTotal', 'scale.cssModules', 'scale.globalCss'] },
  { section: '1', anchor: '页面 `.tsx` / 组件 `.tsx` / hooks', paths: ['scale.pageTsx', 'scale.componentTsx', 'scale.hooks'] },
  { section: '1', anchor: '前端测试文件', paths: ['scale.frontendTestFiles'] },
  { section: '1', anchor: '路由页', paths: ['scale.mainWindowRoutes', 'scale.detachedWindowRoutes'] },
  { section: '1', anchor: '`var(--petri-*)` 引用', paths: ['visualDebt.petriTokenRefs'] },
  { section: '1', anchor: '`--petri-*` 定义', paths: ['visualDebt.petriTokenDefinitions', 'visualDebt.petriTokenDefinitionFiles'] },
  { section: '1', anchor: '遗留 `var(--color-*)`', paths: ['visualDebt.legacyColorRefs'] },
  { section: '1', anchor: 'slate 字面量', paths: ['visualDebt.slateLiteralsRaw', 'visualDebt.slateViolationsAfterExemptions'] },
  { section: '1', anchor: 'CSS 内裸 hex', paths: ['visualDebt.hexInCss'] },
  { section: '1', anchor: 'fallback', paths: ['visualDebt.colorFallbackFiles', 'visualDebt.colorFallbackOccurrences'] },
  { section: '1', anchor: '内联 `style={{`', paths: ['visualDebt.inlineStyleOccurrences', 'visualDebt.inlineStyleFiles'] },
  { section: '1', anchor: '`!important`', paths: ['visualDebt.importantOccurrences', 'visualDebt.importantFiles'] },
  { section: '1', anchor: '数字 `z-index`', paths: ['visualDebt.numericZIndexOccurrences', 'visualDebt.numericZIndexFiles'] },
  { section: '1', anchor: '`@media`', paths: ['visualDebt.mediaQueryOccurrences', 'visualDebt.mediaQueryFiles'] },
  { section: '1', anchor: '`@container`', paths: ['visualDebt.containerQueryRules'] },
  { section: '1', anchor: '断点阈值', paths: ['visualDebt.breakpointThresholds'] },
  { section: '1', anchor: 'ARIA 属性 / `tabIndex`', paths: ['visualDebt.ariaAttributes', 'visualDebt.tabIndex'] },
  { section: '1', anchor: '`;;` 双分号', paths: ['visualDebt.doubleSemicolonFiles'] },
  { section: '0', anchor: 'A 布局与信息架构', paths: ['staticScores.layoutAndIA'] },
  { section: '0', anchor: 'B 用户体验与交互', paths: ['staticScores.uxAndInteraction'] },
  { section: '0', anchor: 'C 视觉一致性与设计感', paths: ['staticScores.visualConsistency'] },
  { section: '0', anchor: 'D 工程化标准与验收能力', paths: ['staticScores.engineeringStandards'] },
  { section: '0', anchor: '**综合（静态口径）**', paths: ['staticScores.composite'] },
];

export function readBaseline(filePath = BASELINE_PATH) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

export function readPlan(filePath = PLAN_PATH) {
  return fs.readFileSync(filePath, 'utf8');
}

export function getByPath(obj, dotted) {
  // 只按自有属性描述符取值：避免动态下标（security/detect-object-injection），
  // 同时不把原型链上的键当作基线字段。
  return dotted.split('.').reduce((acc, key) => {
    if (acc === null || typeof acc !== 'object') return undefined;
    return Object.getOwnPropertyDescriptor(acc, key)?.value;
  }, obj);
}

/** 从 Markdown 里抽所有表格行（第 1/2 列），section 用来隔离 §0 / §1。 */
function tableRows(markdown, section) {
  const start = section === '0'
    ? markdown.indexOf('## 0. 执行摘要')
    : markdown.indexOf('## 1. 现状量化基线');
  const end = section === '0'
    ? markdown.indexOf('## 1. 现状量化基线', start)
    : markdown.indexOf('## 2. 四维度诊断', start);
  if (start < 0 || end < 0 || end <= start) return [];
  return markdown.slice(start, end).split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 4);
}

/**
 * 纯函数对账：给定 baseline 对象与报告 Markdown，返回 problems 数组（空 = PASS）。
 * 测试用它植入篡改/删字段/未登记字段/锚点缺失四类负例。
 */
export function verifyBaseline(baseline, planMarkdown) {
  const problems = [];
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    return ['baseline must be a JSON object'];
  }
  if (baseline.schema !== BASELINE_SCHEMA) {
    problems.push(`schema mismatch: expected ${BASELINE_SCHEMA}, got ${String(baseline.schema)}`);
  }
  for (const key of Object.keys(baseline)) {
    if (!TOP_LEVEL_KEYS.includes(key)) problems.push(`unregistered top-level field: ${key}`);
  }
  for (const key of TOP_LEVEL_KEYS) {
    if (!(key in baseline)) problems.push(`missing top-level field: ${key}`);
  }
  if (!Array.isArray(baseline.plan?.waves) || baseline.plan.waves.length !== 6) {
    problems.push('plan.waves must be the six frozen UI-D waves');
  }
  if (baseline.plan?.started !== true) {
    problems.push('plan.started must be true (UI-D0 冻结后由 false 转 true 并留痕)');
  }
  if (typeof baseline.plan?.startedAt !== 'string' || baseline.plan.startedAt.length === 0) {
    problems.push('plan.startedAt 留痕缺失');
  }
  if (typeof baseline.plan?.ruling !== 'string' || baseline.plan.ruling.length === 0) {
    problems.push('plan.ruling 裁决留痕缺失');
  }
  if (typeof planMarkdown !== 'string' || planMarkdown.length === 0) {
    problems.push('assessment plan markdown is missing');
    return problems;
  }

  const rowsBySection = {
    0: tableRows(planMarkdown, '0'),
    1: tableRows(planMarkdown, '1'),
  };

  for (const contract of FIELD_CONTRACTS) {
    const matched = rowsBySection[contract.section].filter((cells) => cells[1].includes(contract.anchor));
    if (matched.length !== 1) {
      problems.push(`anchor ${contract.anchor} matched ${matched.length} rows in section ${contract.section} (expected 1)`);
      continue;
    }
    const cell = matched[0][2];
    // 数值语义比对，不做字符串字面量比对：JSON 的 3.0 在报告里写作 **3.0**，
    // String(3.0) === '3' 会误判。取整行所有数字构成集合后逐字段核对。
    const numbers = new Set(
      (cell.match(/\d+(?:\.\d+)?/g) || []).map((n) => Number(n)),
    );
    for (const dotted of contract.paths) {
      const value = getByPath(baseline, dotted);
      if (value === undefined) {
        problems.push(`${dotted}: missing baseline field`);
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        problems.push(`${dotted}: expected a finite number`);
        continue;
      }
      if (!numbers.has(value)) {
        problems.push(`${dotted}=${value} not found in report row "${contract.anchor}" column 2 ("${cell}")`);
      }
    }
  }

  // 评分卡目标与基线 gates 的静态口径也锁住，防止 D5 换尺子。
  if (baseline.staticScores?.targetPerDimension !== 4.4) {
    problems.push('staticScores.targetPerDimension must equal frozen 4.4 (建议值, U 类, 不擅自改)');
  }
  if (baseline.gates?.themeTokenContract?.tests !== 19) {
    problems.push('gates.themeTokenContract.tests must equal frozen 19');
  }
  if (baseline.gates?.uiAuditCheck?.result !== 'FAIL') {
    problems.push('gates.uiAuditCheck.result must stay FAIL (W 归属，不为过门改写基线)');
  }
  return problems;
}

export function checkFiles() {
  const baseline = readBaseline();
  const markdown = readPlan();
  return verifyBaseline(baseline, markdown);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const problems = checkFiles();
  if (problems.length > 0) {
    console.error('[ui-baseline] FAIL — 基线与报告 §0/§1 不再相等：');
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`[ui-baseline] PASS — ${FIELD_CONTRACTS.length} 行锚 / ${FIELD_CONTRACTS.reduce((n, c) => n + c.paths.length, 0)} 字段逐项相等（schema=${BASELINE_SCHEMA}）`);
}
