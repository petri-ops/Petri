/**
 * 右栏四裁决（owner msg_44b2179358ea）HK-01：
 * ①生成文件保留 ②workflow 并入 jobs ③evidence 并入 results ④面板打开埋点。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const registry = read('frontend/src/lib/workSurface/registry.ts');
const right = read('frontend/src/components/workspace-panels/RightPanel.tsx');
const title = read('frontend/src/pages/project-workspace/useWorkspaceTitleBar.ts');
const tabs = read('frontend/src/hooks/useWorkSurfaceTabs.ts');
const helper = read('core/petri-server/helpers/panel-usage.js');

test('HK-01-1：生成文件保留独立面板；workflow/evidence 从 core 注册撤除', () => {
  assert.match(registry, /coreSurface\('generated'/);
  assert.doesNotMatch(registry, /coreSurface\('workflow'/);
  assert.doesNotMatch(registry, /coreSurface\('evidence'/);
});

test('HK-01-2：workflow 能力并入 jobs 分支、evidence 并入 results 分支（能力不丢）', () => {
  const jobs = right.slice(right.indexOf("tab === 'jobs'"), right.indexOf("tab === 'model3d'"));
  assert.match(jobs, /WorkflowRunsPanel/);
  const results = right.slice(right.indexOf("tab === 'results'"), right.indexOf("tab === 'files'"));
  assert.match(results, /EvidenceSurface/);
  assert.doesNotMatch(right, /tab === 'workflow'/);
  assert.doesNotMatch(right, /tab === 'evidence'/);
});

test('HK-01-3：菜单四组结构不变、组内去掉 workflow/evidence 两项', () => {
  const groups = title.slice(title.indexOf('const MENU_GROUPS'), title.indexOf('function menuGroupFor'));
  assert.match(groups, /主工作区/);
  assert.match(groups, /分析治理/);
  assert.match(groups, /审计证据/);
  assert.match(groups, /环境入口/);
  assert.doesNotMatch(groups, /'workflow'/);
  assert.doesNotMatch(groups, /'evidence'/);
});

test('HK-01-4：面板埋点表+三动作调用（新事件类不混 funnel 白名单）', () => {
  assert.match(helper, /CREATE TABLE IF NOT EXISTS panel_usage_events/);
  assert.match(tabs, /trackPanelUsage\(/);
  assert.match(tabs, /'open'/);
  assert.match(tabs, /'close'/);
  assert.match(tabs, /'switch'/);
});
