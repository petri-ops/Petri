/**
 * BLOCK-267 — dev-verify env 陷阱静态检查（AUDIT-LOG 🟡 两次踩坑固化）。
 *
 * 陷阱：flow 被脚本 require 时若在模块顶层写 `const X = process.env.Y`，
 * env 尚未设置 → 空值被固化成模块级常量（暗色轮发亮色截图且报告自称 dark=true）。
 *
 * 规则（只红最危险的顶层字面赋值形态，函数体内的调用时读取不拦）：
 *   - 顶层 `const X = process.env.Y` 字面赋值即红（必须改成调用时读取的函数/箭头）；
 *   - 顶层 `const {..} = process.env` 解构同红。
 * 豁免：行内含 `_OK`/`_ALLOW` 后缀的显式豁免标记。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOWS_DIR = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'flows');

function listFlowFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFlowFiles(full));
    else if (entry.name.endsWith('.cjs') || entry.name.endsWith('.mjs')) out.push(full);
  }
  return out;
}

/** 纯函数：给定源码，返回顶层 env 固化赋值的行号清单（供测试与 CLI 复用）。 */
export function findTopLevelEnvConst(source) {
  const lines = source.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
    if (/_OK\b|_ALLOW\b/.test(line)) continue;
    // 单 const 与解构两种顶层形态（不匹配缩进行=函数体内调用时读取不拦）
    if (/^const\s+[A-Za-z_$][\w$]*\s*=\s*process\.env\b/.test(line) || /^const\s*\{[^}]*\}\s*=\s*process\.env\b/.test(line)) {
      hits.push(i + 1);
    }
  }
  return hits;
}

test('findTopLevelEnvConst：顶层 const=process.env 命中，函数体内调用时读取不拦', () => {
  const bad = 'const DARK = process.env.PETRI_DARK;\nfunction f() { const X = process.env.Y; }';
  assert.deepEqual(findTopLevelEnvConst(bad), [1]);
  const good = 'function f() { return process.env.Y; }\nconst read = () => process.env.Z;';
  assert.deepEqual(findTopLevelEnvConst(good), []);
});

test('findTopLevelEnvConst：解构形态同红；显式 _OK/_ALLOW 后缀豁免', () => {
  assert.deepEqual(findTopLevelEnvConst('const { A, B } = process.env;'), [1]);
  assert.deepEqual(findTopLevelEnvConst('const DARK_OK = process.env.PETRI_DARK;'), []);
});

test('全部 flow 文件零顶层 env 固化（棘轮：新增即红）', () => {
  const files = listFlowFiles(FLOWS_DIR);
  assert.ok(files.length > 10, `flow 文件量异常：${files.length}`);
  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const lineNo of findTopLevelEnvConst(src)) {
      offenders.push(`${path.relative(ROOT, file)}:${lineNo}`);
    }
  }
  assert.deepEqual(offenders, [], `以下 flow 文件存在顶层 env 固化（改函数化调用时读取）：\n${offenders.join('\n')}`);
});
