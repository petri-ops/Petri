/**
 * P6 ready 握手层专项（2026-11-23）— HK-01 契约（纯源码，不跑 Electron）。
 *
 * 上移卡点：补 handler 后 result.html 已真实加载（iframe target=1、document complete、
 * 表格数据渲染），但 (a) 探针仍读产品不设的 window.__petriSurfaceReady 信号名，
 * 与产品实发的 postMessage petri:ready 错配；(b) waitFor 的 executeJavaScript 无超时
 * 保护，pack iframe 渲染期主上下文挂起时永久阻塞 → 主流程被 watchdog 强杀。
 *
 * 本票仅改 harness 观测：宿主 message tap 捕 petri:ready + waitFor 超时防护。
 * 不改产品 sandbox/CSP/凭据/B1 token/handler。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIVER = path.join(ROOT, 'scripts', 'g0-rs-p6-electron-pressure-driver.cjs');
const src = () => fs.readFileSync(DRIVER, 'utf8');

test('宿主 message tap 已启用：捕产品实发的 petri:ready postMessage', () => {
  const s = src();
  assert.match(s, /function _installHostMessageTap\s*\(/, '须保留宿主 message tap 函数');
  assert.match(s, /_installHostMessageTap\s*\(/, '须调用宿主 message tap');
  // 2026-11-23 裁决配套修法：addScriptToEvaluateOnNewDocument 在此场景挂起，
  // 改用 Runtime.evaluate 在 navigate 的 loadURL 后注入（见 p6-inspect-decider.test.mjs）。
  const tapDef = s.search(/function _installHostMessageTap\s*\(/);
  assert.ok(tapDef >= 0, '须有 tap 定义');
  const around = s.slice(tapDef, tapDef + 900);
  assert.match(around, /Runtime\.evaluate/, 'tap 注入须用 Runtime.evaluate（替代挂起的 addScriptToEvaluateOnNewDocument）');
  assert.match(s, /hostTapReady/, 'tap 启用状态须落证');
});

test('探针 readySignal 判据以 petri:ready postMessage 为准（非 __petriSurfaceReady 单例）', () => {
  const s = src();
  assert.match(
    s,
    /type\s*===?\s*['"]petri:ready['"]/,
    '判据须含 petri:ready postMessage 类型检查',
  );
  assert.match(s, /readySent|hostMessages\.some/, 'readySent 须来自 hostMessages（宿主捕获）');
});

test('waitFor 的求值有超时防护（防主上下文挂起永久阻塞）', () => {
  const s = src();
  const guardedDef = s.search(/async function evaluateGuarded\s*\(/);
  assert.ok(guardedDef >= 0, '须存在 evaluateGuarded 求值包装');
  const body = s.slice(guardedDef, guardedDef + 700);
  assert.match(body, /executeJavaScript/, 'guarded 求值须用 executeJavaScript');
  assert.match(
    body,
    /Promise\.race/,
    'executeJavaScript 须包 Promise.race 超时防护（挂起时重试而非永久阻塞）',
  );
  const waitForDef = s.search(/async function waitFor\s*\(/);
  assert.ok(s.slice(waitForDef, waitForDef + 500).includes('evaluateGuarded'), 'waitFor 须走 guarded 求值');
});

test('table_load 各步有 subStage 打点（挂起源精确落证）', () => {
  const s = src();
  assert.match(s, /let subStage\s*=\s*'init'/, '须声明 subStage');
  for (const step of ['navigate', 'inspectTable', 'attachDebugger', 'visualDigest', 'sampleMemory']) {
    assert.ok(
      s.includes(`subStage = '${step}'`),
      `table_load ${step} 步须打点（watchdog 落证带出以定位挂起源）`,
    );
  }
  assert.match(s, /subStage,[\s\S]{0,80}timeoutReason|failedStage: stage,\s*subStage/, '落证须带 subStage');
});

test('navigate 的 loadURL 用 domcontentloaded（pack iframe 子资源不阻塞主文档导航）', () => {
  const s = src();
  const navDef = s.search(/async function navigate\s*\(/);
  assert.ok(navDef >= 0, '须存在 navigate 定义');
  const body = s.slice(navDef, navDef + 600);
  assert.match(body, /loadURL\s*\(/, 'navigate 须用 loadURL');
  assert.match(
    body,
    /waitUntil\s*:\s*['"]domcontentloaded['"]/,
    'loadURL 须带 waitUntil:domcontentloaded——否则 pack iframe 子资源加载让 load 事件延迟，主流程挂起',
  );
});

test('产品协议未被本票改写（红线：不改产品 sandbox/CSP/凭据/handler）', () => {
  const packFrame = fs.readFileSync(
    path.join(ROOT, 'frontend', 'src', 'components', 'work-surface', 'PackSurfaceFrame.tsx'), 'utf8',
  );
  const scheme = fs.readFileSync(
    path.join(ROOT, 'src', 'main', 'pack-ui', 'scheme.js'), 'utf8',
  );
  assert.match(packFrame, /allow-top-navigation-to-custom-protocols/, '产品 B1 token 仍在');
  assert.match(scheme, /protocol\.handle\(SCHEME/, '产品 handler 仍在');
  assert.match(scheme, /Content-Security-Policy/, '产品 CSP 仍在');
});
