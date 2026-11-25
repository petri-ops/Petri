/**
 * item 41 hotfix — 内联 var() 引号防复发契约（HK-01 红绿先行）。
 *
 * 背景：B1 z-index 分支把 JSX style 对象的 zIndex 值写成裸 `var(--petri-z-xxx)`。
 * JSX style 是 JavaScript 对象字面量，CSS 变量必须以字符串字面量书写
 * （`zIndex: 'var(--petri-z-xxx)'`）；裸写是无效 JS 表达式，tsc/eslint TSX parser
 * 报 `Parsing error: Expression expected`。本机缺 frontend/node_modules 时 eslint
 * 跳过 TSX 解析，CI 干净环境才暴露。本契约扫描全仓 .tsx，钉死内联值零裸 var()。
 *
 * 命中形态限定为对象属性 `键: var(--...`，不误伤字符串值内的 var()
 * （如 `border: '1px solid var(--petri-border)'`）与模板字面量值
 * （如 `width: \`var(--petri-live-right-width, ${n}px)\``），两者都是合法写法。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'frontend', 'src');

function walkTsx(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsx(full));
      continue;
    }
    if (!entry.name.endsWith('.tsx')) continue;
    if (/\.(test|spec)\.tsx$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

const BARE_VAR_VALUE = /\b[A-Za-z_$][\w$]*\s*:\s*var\(\s*--[A-Za-z0-9-]+/g;

function findBareVar(text) {
  return [...text.matchAll(BARE_VAR_VALUE)].map((m) => m[0]);
}

test('Q1 全仓 .tsx 内联 style 零裸 var(--...)（必须带引号）', () => {
  const offenders = [];
  for (const file of walkTsx(SRC)) {
    const hits = findBareVar(fs.readFileSync(file, 'utf8'));
    if (hits.length) offenders.push(`${path.relative(ROOT, file)} → ${hits.join(' | ')}`);
  }
  assert.deepEqual(offenders, [], `内联裸 var(--...) 必须归零：\n${offenders.join('\n')}`);
});

test('Q2 合成红自证：裸 var 命中、引号与模板写法不误伤', () => {
  assert.equal(findBareVar("style={{ zIndex: var(--petri-z-toast) }}").length, 1, '裸 var 须命中');
  assert.equal(findBareVar("zIndex: 'var(--petri-z-toast)'").length, 0, '单引号写法不得误伤');
  assert.equal(findBareVar('zIndex: "var(--petri-z-toast)"').length, 0, '双引号写法不得误伤');
  assert.equal(findBareVar("border: '1px solid var(--petri-border)'").length, 0, '字符串内 var 不得误伤');
  assert.equal(findBareVar('width: `var(--petri-live-right-width, ${n}px)`').length, 0, '模板字面量不得误伤');
});
