#!/usr/bin/env node
/**
 * scripts/quality-frontend-deps-gate.mjs — 前端依赖存在性硬门（item 43 防复发门）
 *
 * 根因：本机缺 frontend/node_modules 时，quality:lint 的 projectService 无法为
 * frontend/tsconfig.json 建立完整 TS program，type-aware 规则静默跳过 TSX 解析
 * （item 41 的 10 处裸 var() 曾因此本机全绿、CI 干净环境才暴露）。
 *
 * 本门在 closeout 的 lint/types 之前 fail-closed：缺依赖即明确报错退出，不允许
 * 质量门以「静默跳过」形态给出假绿。零新依赖，仅用 node:fs / node:path。
 *
 * 安装方式：npm --prefix frontend ci
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND_MODULES = path.join(ROOT, 'frontend', 'node_modules');
// typescript 是 type-aware lint 与 quality:types 的共同底座；存在它即视为前端依赖已装。
const MARKER = path.join(FRONTEND_MODULES, 'typescript', 'package.json');

if (!fs.existsSync(FRONTEND_MODULES) || !fs.statSync(FRONTEND_MODULES).isDirectory()) {
  console.error('[quality:frontend-deps] FAIL 缺 frontend/node_modules：type-aware lint 会静默跳过 TSX 解析（假绿根因）。');
  console.error('[quality:frontend-deps] 修复：npm --prefix frontend ci');
  process.exit(1);
}
if (!fs.existsSync(MARKER)) {
  console.error('[quality:frontend-deps] FAIL frontend/node_modules 不完整：缺 typescript（type-aware lint / quality:types 底座）。');
  console.error('[quality:frontend-deps] 修复：npm --prefix frontend ci');
  process.exit(1);
}
console.log('[quality:frontend-deps] PASS frontend/node_modules 存在且含 typescript');
