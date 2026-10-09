import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * BLOCK-154 波次 2 — 桌面主入口同步子进程禁令（BK-08 缺陷类机械门禁）。
 *
 * 同类缺陷第二现转门禁（governance 纪律；第一现=tunnel.js，由 block145-tunnel-async
 * 守护）：main.js 曾在 app ready 后窗口创建前 spawnSync(migration-runner) 同步阻塞
 * 事件循环（timeout 30s，最坏全冻结窗口/IPC——与 BK-08 tunnel 同步 ssh 同族）。
 * 本测试锁定 src/main.js 不再出现任何同步子进程调用（spawnSync / execSync /
 * execFileSync，含解构别名声明）；注释/字符串中的字样不触发（stripJs 词法打空后
 * 违规精确回指源码行号）。
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_PATH = path.join(ROOT, 'src', 'main.js');

const SYNC_SPAWN_RE = /\b(?:spawnSync|execSync|execFileSync)\b/;

// 轻量 JS 预处理：注释 / 字符串 / 模板字面量按 1:1 长度打空（同 block145 手法，
// 防注释字样误触；打空后长度不变，违规可精确回指源码行号）。
// 已知局限（对本文件面足够）：不解析正则字面量内容；模板内插值整体打空。
function stripJs(src) {
  let out = '';
  let mode = 'code'; // code | line | block | squote | dquote | template
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const d = i + 1 < src.length ? src[i + 1] : '';
    if (c === '\n') {
      out += '\n';
      if (mode === 'line') mode = 'code';
      continue;
    }
    if (mode === 'code') {
      if (c === '/' && d === '/') { mode = 'line'; out += '  '; i += 1; continue; }
      if (c === '/' && d === '*') { mode = 'block'; out += '  '; i += 1; continue; }
      if (c === "'" || c === '"' || c === '`') {
        mode = c === "'" ? 'squote' : c === '"' ? 'dquote' : 'template';
        out += ' ';
        continue;
      }
      out += c;
      continue;
    }
    if (mode === 'line') { out += ' '; continue; }
    if (mode === 'block') {
      if (c === '*' && d === '/') { mode = 'code'; out += '  '; i += 1; continue; }
      out += ' ';
      continue;
    }
    // 字符串 / 模板内部
    if (c === '\\') { out += '  '; i += 1; continue; }
    if ((mode === 'squote' && c === "'") || (mode === 'dquote' && c === '"') || (mode === 'template' && c === '`')) {
      mode = 'code';
      out += ' ';
      continue;
    }
    out += ' ';
  }
  return out;
}

test('main.js 启动路径零同步子进程调用（BK-08 缺陷类门禁）', () => {
  const src = readFileSync(MAIN_PATH, 'utf8');
  const stripped = stripJs(src);
  const violations = [];
  stripped.split('\n').forEach((line, i) => {
    if (SYNC_SPAWN_RE.test(line)) violations.push(`  main.js:${i + 1}: ${line.trim()}`);
  });
  assert.deepEqual(
    violations,
    [],
    [
      'src/main.js 存在同步子进程调用（spawnSync/execSync/execFileSync）——',
      '冷启动路径同步阻塞事件循环（BK-08 缺陷类，同族守护见 block145-tunnel-async.test.mjs）。',
      '违规行：',
      ...violations,
    ].join('\n'),
  );
});
