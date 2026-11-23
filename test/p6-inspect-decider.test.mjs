/**
 * P6 inspectTable 判据裁决（2026-11-23）— HK-01 契约（纯源码，不跑 Electron）。
 *
 * 裁决：选「原生 viewer」方向（保住 P6 10 万行虚拟表格性能语义），因其需产品侧
 * 停用 bio pack 的 table result surface（超出 harness 红线）→ 停下报用户，不擅改。
 * 改读 pack #bioTable 被否决：其为 200 行截断预览，会降级测量语义。
 * 本票在 harness 内只做 tap 配套修法：Runtime.evaluate 在 loadURL 后注入监听。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIVER = path.join(ROOT, 'scripts', 'g0-rs-p6-electron-pressure-driver.cjs');
const DECISION = path.join(ROOT, 'acceptance', 'p6-inspect-decider', 'DECISION.md');
const src = () => fs.readFileSync(DRIVER, 'utf8');

test('裁决材料在案：方向 B（原生 viewer）+ 保住 10万行语义理由 + pack #bioTable 200行证据', () => {
  assert.ok(fs.existsSync(DECISION), '须落裁决材料 acceptance/p6-inspect-decider/DECISION.md');
  const d = fs.readFileSync(DECISION, 'utf8');
  assert.match(d, /原生 viewer|原生表格/, '须记录方向 B（原生 viewer）');
  assert.match(d, /10\s*万行|100,?000|10万行/, '须说明保住 10万行虚拟表格性能语义');
  assert.match(d, /200\s*行|slice\(0,\s*200\)|MAX_TABLE_ROWS/, '须记录 pack #bioTable 200 行截断证据');
  assert.match(d, /停下报用户|需产品侧|超出.*harness/, '须记录产品侧改动停下报用户');
});

test('tap 用 Runtime.evaluate 注入（替代挂起的 addScriptToEvaluateOnNewDocument）', () => {
  const s = src();
  const def = s.search(/function _installHostMessageTap\s*\(/);
  assert.ok(def >= 0, '须有 tap 定义');
  const body = s.slice(def, def + 1200);
  assert.match(body, /Runtime\.evaluate/, 'tap 须用 Runtime.evaluate 注入');
  assert.doesNotMatch(body, /addScriptToEvaluateOnNewDocument/, '不得再用挂起的 addScriptToEvaluateOnNewDocument');
  assert.match(body, /addEventListener\s*\(\s*['"]message/, '须注册 message 监听捕 petri:ready');
});

test('tap 注入时机在 navigate 的 loadURL 之后（Runtime.evaluate 只在已提交文档上下文存活）', () => {
  const s = src();
  const navDef = s.search(/async function navigate\s*\(/);
  assert.ok(navDef >= 0);
  const body = s.slice(navDef, navDef + 1100);
  const loadUrlAt = body.indexOf('loadURL(');
  const tapAt = body.indexOf('_installHostMessageTap(');
  assert.ok(loadUrlAt >= 0, 'navigate 须 loadURL');
  assert.ok(tapAt >= 0, 'navigate 内须调用 tap（loadURL 后注入，页面重载后 listener 存活）');
  assert.ok(tapAt > loadUrlAt, 'tap 注入须在 loadURL 之后');
  assert.match(body, /Promise\.race|timeout|Timeout/, 'tap 注入须带超时防护');
});

test('产品协议未被本票改写（红线：不改产品 sandbox/CSP/凭据/handler/注册表）', () => {
  const packFrame = fs.readFileSync(
    path.join(ROOT, 'frontend', 'src', 'components', 'work-surface', 'PackSurfaceFrame.tsx'), 'utf8',
  );
  const scheme = fs.readFileSync(path.join(ROOT, 'src', 'main', 'pack-ui', 'scheme.js'), 'utf8');
  const packJson = fs.readFileSync('/Users/zhangdiandian/Documents/1.WorkDir/petri-pack-bio/pack.json', 'utf8');
  assert.match(packFrame, /allow-top-navigation-to-custom-protocols/, '产品 B1 token 仍在');
  assert.match(scheme, /protocol\.handle\(SCHEME/, '产品 handler 仍在');
  assert.match(scheme, /Content-Security-Policy/, '产品 CSP 仍在');
  assert.match(packJson, /"table"/, 'pack.json 的 table 声明未被删（产品侧改动未擅做）');
});
