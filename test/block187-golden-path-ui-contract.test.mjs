/**
 * BLOCK-187 P2 — 黄金路径 ≤7 步零断点机械门（源码契约，确定性、无 mock、无人眼）。
 *
 * 动机=把「冷启动输入框退化为纯选择器死态」这一复发缺陷类（UI-369→UI-373 同族，第三次）
 * 转为机械守卫：若有人再把 composer 挂回项目选择门后，或把无项目发送拦成无恢复的死态，本门即红。
 * 另断黄金路径步数 ≤7（真值在 docs/first-success-path.md「当前产品黄金路径」节）。
 * 里程碑/TTFS 的端到端证明在 evals golden 套件（test/evals-harness.test.mjs 覆盖判据 kind），本门专守 UI 面。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'first-success-path.md'), 'utf8');
const WELCOME = fs.readFileSync(path.join(ROOT, 'frontend', 'src', 'pages', 'welcome.tsx'), 'utf8');

function currentGoldenPathStepCount(md) {
  const start = md.indexOf('## 当前产品黄金路径');
  assert.ok(start >= 0, 'first-success-path.md 须含「当前产品黄金路径」节（BLOCK-187 真相锚）');
  const rest = md.slice(start);
  const end = rest.indexOf('\n## ', 5); // 下一个二级标题即本节结束
  const section = end > 0 ? rest.slice(0, end) : rest;
  const steps = section.split('\n').filter((line) => /^\d+\.\s+\S/.test(line));
  return steps.length;
}

test('黄金路径步数 ≤7（阶段 1 出口判据机械核）', () => {
  const n = currentGoldenPathStepCount(DOC);
  assert.ok(n >= 1 && n <= 7, `当前产品黄金路径步数应 ≤7，实测 ${n}`);
});

test('零断点·composer 常驻（UI-373 冷启动死态复发守卫：挂载只由 backendReady 决定，不由项目选择门控）', () => {
  assert.match(WELCOME, /const\s+chatMounted\s*=\s*backendReady\s*;/,
    'chatMounted 必须 === backendReady（回归成 selectedProject && backendReady 会复活「无项目即无输入框」死态）');
  assert.doesNotMatch(WELCOME, /const\s+chatMounted\s*=\s*Boolean\(\s*selected/,
    'chatMounted 不得再被项目选择布尔门控');
});

test('零断点·无项目发送非死态（guardNoProjectSend 必须展开选择器给恢复路，而非空拦）', () => {
  const guardStart = WELCOME.indexOf('function guardNoProjectSend');
  assert.ok(guardStart >= 0, 'guardNoProjectSend 应在位（无项目发送统一入口）');
  const guardBody = WELCOME.slice(guardStart, guardStart + 260);
  assert.match(guardBody, /setPickerOpen\(\s*true\s*\)/, '无项目发送须展开选择器（用户能就地建/选项目，非死路）');
});

test('零断点·建项目入口真实接线（createFromFolder 调用 createProject，非 TODO/占位）', () => {
  assert.match(WELCOME, /const\s+project\s*=\s*await\s+createProject\(\{/,
    'createFromFolder 必须真实调 createProject（POST /api/data/projects，落 project_created 里程碑）');
});

test('零断点·聊天模块原生嵌入（composer=真 SimpleChat，非手搓输入框）', () => {
  assert.match(WELCOME, /import\s*\{[^}]*SimpleChat[^}]*\}\s*from/, '须 import SimpleChat');
  assert.match(WELCOME, /<SimpleChat[\s>]/, 'welcome 页须渲染 <SimpleChat');
});

test('零断点·黄金路径面零 TODO/未实现标记（限关键接线标识区）', () => {
  // 全文件级 TODO 扫描太宽；只守黄金路径关键处理函数体内不得留未实现占位。
  const fnNames = ['guardNoProjectSend', 'createFromFolder', 'openFolderDialogOrFallback', 'selectProject'];
  for (const fn of fnNames) {
    const i = WELCOME.indexOf(`function ${fn}`);
    if (i < 0) continue;
    const body = WELCOME.slice(i, i + 400);
    assert.doesNotMatch(body, /TODO|FIXME|未实现|coming soon|not implemented|throw new Error\('stub/i,
      `${fn} 处理函数体内不得留未实现占位（黄金路径断点）`);
  }
});
