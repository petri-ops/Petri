/**
 * BLOCK-410（第五轮 L6 体验可达性与人设）契约测试。
 * 源码锚 + 组件级行为断言（vitest 渲染面归前端测试文件）；观感归 E 不代答。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---- L6-1 / L-62：CommandPalette 键盘可达 ----
test('L6-1 源码锚：palette 方向键跳 header + Tab 循环 + 焦点还原 + listbox/activedescendant', () => {
  const src = read('frontend/src/components/copilot/CommandPalette.tsx');
  assert.match(src, /nextSelectable/, '跳 header 助手在场');
  assert.match(src, /prevFocus\?\./, '关闭归还外部焦点');
  assert.match(src, /case 'Tab':/, 'Tab 循环（输入↔列表）');
  assert.match(src, /role="listbox"/, 'listbox 容器');
  assert.match(src, /aria-activedescendant=/, 'combobox 活动项关联');
  assert.match(src, /id=\{`cp-opt-\$\{item\.id\}`\}/, 'option 唯一 id');
  assert.doesNotMatch(src, /resolveCore\(\.\.\._parts\)/);
});

// ---- L6-2 / L-63：ThemeProvider 读侧状态 + 抑制静默回正 ----
test('L6-2 源码锚：pull 读侧失败入 prefsSync + retry pending 抑制回正 + 恢复清条', () => {
  const src = read('frontend/src/themes/ThemeProvider.tsx');
  assert.match(src, /主题偏好服务端不可达（读侧）/, '读侧失败条文案（入既有 role=status 呈现面）');
  assert.match(src, /retryPending/, 'push 重放期抑制读侧回正');
  assert.match(src, /readFailNoted = false/, '读侧恢复清条');
});

// ---- L6-3 / L-64：四条 verified 冒认降级 + 台账门转绿 ----
test('L6-3 台账：四条降回 in_progress（标题行 L6-3/BLOCK-410 降级注记）', () => {
  const ledger = read('docs/ui-productization-audit.md');
  for (const id of ['UI-482', 'UI-593', 'UI-693', 'UI-650']) {
    const row = ledger.split('\n').find((l) => l.startsWith(`## ${id}:`));
    assert.ok(row, `${id} 段在场`);
    assert.match(row, /in_progress（L6-3\/BLOCK-410 降级/, `${id} 已降回 in_progress`);
    assert.doesNotMatch(row, /verified（/, `${id} 标题不再含 verified`);
  }
});

// ---- L6-5 / L-69：RouteFallback 可见文本 + 详情折叠 ----
test('L6-5 源码锚：RouteFallback role=status 可见文本；错误详情 details 折叠', () => {
  const app = read('frontend/src/App.tsx');
  assert.match(app, /正在加载页面…/, 'fallback 可见文本（aria-busy 不播报问题的修复）');
  assert.match(app, /role="status"/, 'role=status 播报');
  const eb = read('frontend/src/components/RouteErrorBoundary.tsx');
  assert.match(eb, /<details/, '错误详情默认折叠');
  assert.match(eb, /错误详情（点开复制诊断）/, '复制诊断入口文案');
});

// ---- L6-6 / L-72：本地主权说明（人设可见化最小件；chip/审批文案=观感归 E 补腿） ----
test('L6-6 设置面本地主权说明（role=note）', () => {
  const m = read('frontend/src/components/desktop/DesktopSettingsPanel/MaintenanceSection.tsx');
  assert.match(m, /data-testid="local-sovereignty-note"/, '本地主权说明在场');
  assert.match(m, /role="note"/);
});

// ---- L6-7 / L-81：历史证据只读索引 ----
test('L6-7 historic-unverifiable 索引在册（不回填历史；严格元数据门分界在案）', () => {
  const idx = JSON.parse(read('acceptance/post-k7-2026-11-10/l6/historic-evidence-index.json'));
  assert.equal(idx.status, 'historic-unverifiable');
  assert.match(idx.boundary, /post-h9-2026-11-10/, '严格元数据门分界');
});
