/**
 * UI-705 — 更新入口形态迭代：标题栏内嵌 UpdatePill（对标 Qoder「⬇ 更新」pill，
 * 用户裁决 2026-11-17「对比一下我们 petri 的更新 是否能做到相似的效果」）。
 *
 * 契约：
 *  1) UpdatePill 挂 TitleBar windowTools（铃铛旁）；仅 available 时出现（推送制，
 *     不常驻——P3-c/体验优先）；点击展开就地面板（版本/下载/进度/安装/稍后）；
 *  2) 「稍后」= session 内 dismiss（新版本推送 available 翻转时复现）；
 *  3) 右下角 UpdateCard 退役（同一状态源形态迭代，不双入口并存）：
 *     组件三件套删除、App.tsx 无挂载；
 *  4) auto-update demo 档：PETRI_UPDATE_DEMO=1（仅未打包 dev 分支）时 stub
 *     handler 返回模拟 hasUpdate + 下载流转——测试实例可见 pill 全流转；
 *     packaged 链路零触碰。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('UpdatePill 组件在场：挂 TitleBarRightZone windowTools（铃铛旁）', () => {
  const zone = read('frontend/src/components/desktop/titlebar/TitleBarRightZone.tsx');
  assert.match(zone, /import \{ UpdatePill \} from '\.\/UpdatePill'/, 'RightZone 导入 UpdatePill');
  assert.match(zone, /<UpdatePill \/>/, 'windowTools 区挂载（铃铛同区）');
  assert.ok(fs.existsSync(path.join(ROOT, 'frontend/src/components/desktop/titlebar/UpdatePill.tsx')), 'UpdatePill.tsx 存在');
});

test('UpdatePill 形态契约：available 才出现 + 点击展开 + 稍后 dismiss + 下载流转', () => {
  const src = read('frontend/src/components/desktop/titlebar/UpdatePill.tsx');
  // 推送制：仅 available/downloaded 时渲染（不常驻占位）
  assert.match(src, /!auto\.available && !auto\.downloaded/, '无更新不渲染');
  // dismiss：稍后 = 本会话隐藏；新推送（available 变化）复现
  assert.match(src, /dismissed/, '稍后语义在场');
  // 主按钮流转：下载更新 → 下载中（进度）→ 安装更新
  assert.match(src, /下载更新/, '下载按钮');
  assert.match(src, /安装更新/, '安装按钮（下载完成后）');
  // 面板可关闭（✕）与 aria
  assert.match(src, /aria-label="更新面板"|aria-expanded/, '可访问性');
});

test('UpdateCard 退役：组件三件套删除 + App.tsx 无挂载（不双入口并存）', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'frontend/src/components/desktop/UpdateCard.tsx')), false, 'UpdateCard.tsx 已删除');
  assert.equal(fs.existsSync(path.join(ROOT, 'frontend/src/components/desktop/UpdateCard.module.css')), false, 'module.css 已删除');
  assert.equal(fs.existsSync(path.join(ROOT, 'frontend/src/components/desktop/UpdateCard.test.tsx')), false, '旧测试已被 UpdatePill 测试接替');
  const app = read('frontend/src/App.tsx');
  assert.doesNotMatch(app, /UpdateCard/, 'App.tsx 不得再挂 UpdateCard');
});

test('auto-update demo 档：PETRI_UPDATE_DEMO=1（仅 dev 未打包分支）注册模拟 handler', () => {
  const src = read('src/ipc/auto-update.js');
  assert.match(src, /PETRI_UPDATE_DEMO/, 'demo 档开关在场');
  assert.match(src, /hasUpdate: true/, 'demo 返回有更新');
  // 隔离：demo 档必须位于未打包 dev 分支内、且在真实 createMacOssUpdater 装配之前
  // （demo 先 return；packaged 构建走不到该分支 = 真实链路零触碰）。
  const demoIdx = src.indexOf('PETRI_UPDATE_DEMO');
  const stubIdx = src.indexOf('auto-update is available in packaged macOS builds only');
  const realIdx = src.indexOf('const updater = createMacOssUpdater');
  assert.ok(demoIdx > 0 && stubIdx > 0 && demoIdx < stubIdx, 'demo 档先于 disabled stub（分支内先 return）');
  assert.ok(realIdx > demoIdx, '真实 updater 装配在 demo 档之后（packaged 链路零触碰）');
});

test('MaintenanceSection 手动检查入口保留（设置内折叠 details 不受形态迭代影响）', () => {
  const src = read('frontend/src/components/desktop/DesktopSettingsPanel/MaintenanceSection.tsx');
  assert.match(src, /手动检查更新/, '折叠 details 在场');
  assert.match(src, /UpdateChecker/, 'UpdateChecker 仍挂载');
});
