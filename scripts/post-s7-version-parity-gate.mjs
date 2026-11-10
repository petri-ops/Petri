#!/usr/bin/env node
/**
 * scripts/post-s7-version-parity-gate.mjs — 跨语言版本字面量对账门（B-17 followUp）。
 *
 * H4 把后端六处版本字面量收编到 core/shared-backend/schema-versions.js，但前端 TS
 * (ArtifactSelection.contractVersion: 1) 与插件 run-plugin-script 的 artifactSchemaVersion
 * 属跨进程/跨语言边界，前端不能 require 后端模块（R4）。故这里**不新建第二真相源**、
 * 不复制常量，只做机械对账：扫描生产面字面量，与登记处的值逐一比对，漂移即红。
 *
 * 用法：node scripts/post-s7-version-parity-gate.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const versions = require(path.join(ROOT, 'core/shared-backend/schema-versions.js'));

/** 生产面字面量点（测试 fixture 不算：它们是冻结契约的输入，不是第二定义）。 */
/**
 * BLOCK-394 B-17：插件 / 产物侧 artifactSchemaVersion 已从 5 处字面量收编为
 * 对 schema-versions.js 的引用。这里钉「引用在册」而不是字面量值——
 * 防止有人把引用改回硬编码（那会重新制造单边升版漏改）。
 */
export const SCHEMA_REFERENCE_POINTS = [
  'core/petri-server/mcp/registry/run-plugin-script.js',
  'core/petri-server/plugin-loader.js',
  'core/petri-server/helpers/tools-executor.js',
  'core/petri-server/helpers/artifact-truth.js',
  'core/shared-backend/scientific-replay-package.js',
];

export const PRODUCTION_LITERAL_POINTS = [
  { file: 'frontend/src/lib/artifact-selection.ts', pattern: /contractVersion:\s*(\d+)/g, field: 'RESULT_STUDIO_CONTRACT_VERSION' },
  { file: 'frontend/src/components/workspace-panels/Model3DResultViewer.tsx', pattern: /contractVersion:\s*(\d+)/g, field: 'RESULT_STUDIO_CONTRACT_VERSION' },
];

export function evaluateParity(readFile = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')) {
  const issues = [];
  const checked = [];
  for (const point of PRODUCTION_LITERAL_POINTS) {
    let text;
    try { text = readFile(point.file); } catch { issues.push(`${point.file}: unreadable`); continue; }
    const found = [...text.matchAll(point.pattern)].map((m) => Number(m[1]));
    if (!found.length) { issues.push(`${point.file}: no literal found (定义被移走但未登记)`); continue; }
    for (const value of found) {
      checked.push({ file: point.file, field: point.field, value });
      if (value !== versions[point.field]) {
        issues.push(`${point.file}: ${point.field} 字面量 ${value} ≠ 登记处 ${versions[point.field]}`);
      }
    }
  }
  for (const file of SCHEMA_REFERENCE_POINTS) {
    let text;
    try { text = readFile(file); } catch { issues.push(`${file}: unreadable`); continue; }
    if (!text.includes('ARTIFACT_SCHEMA_VERSION')) {
      issues.push(`${file}: 插件侧版本未引用 schema-versions 单源（字面量回潮）`);
    }
    if (/artifactSchemaVersion\s*[:=]\s*\d+|artifactSchemaVersion\s*\|\|\s*\d+/.test(text)) {
      issues.push(`${file}: 仍有 artifactSchemaVersion 数字字面量`);
    }
    checked.push({ file, field: 'ARTIFACT_SCHEMA_VERSION', value: 'single-source-ref' });
  }
  return { ok: issues.length === 0, issues, checked, registry: versions };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = evaluateParity();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else if (result.ok) console.log(`[version-parity] PASS — ${result.checked.length} 处跨语言字面量与 schema-versions 一致`);
  else {
    console.error('[version-parity] FAIL：');
    for (const i of result.issues) console.error(`  - ${i}`);
  }
  process.exitCode = result.ok ? 0 : 1;
}
