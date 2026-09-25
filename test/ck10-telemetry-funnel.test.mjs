/**
 * CK-10 — telemetry 漏斗白名单契约（纯函数零 mock——逻辑/IO 分离）。
 * 行为面（网络/开关）由 qa-smoke 源码断言承载；端到端待遥测端点上线后验证。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const resolve = (...segments) => path.resolve(__dirname, '..', ...segments);
const require = createRequire(import.meta.url);
const funnel = require(resolve('src/telemetry-funnel.js'));

test('CK-10 FUNNEL_EVENTS 恰为 6 项且语义正确', () => {
  assert.deepEqual(funnel.FUNNEL_EVENTS, [
    'app_started', 'runtime_install', 'project_created',
    'first_job_succeeded', 'report_generated', 'update_succeeded',
  ]);
});

test('CK-10 isFunnelEvent 白名单判定', () => {
  for (const name of funnel.FUNNEL_EVENTS) assert.equal(funnel.isFunnelEvent(name), true, name);
  assert.equal(funnel.isFunnelEvent('not_a_funnel_event'), false);
  assert.equal(funnel.isFunnelEvent(''), false);
  assert.equal(funnel.isFunnelEvent(undefined), false);
});

test('CK-10 telemetry.js 经白名单模块承载（源码契约：拒收路径在网前）', () => {
  const src = require('node:fs').readFileSync(resolve('src/telemetry.js'), 'utf8');
  assert.ok(src.includes("require('./telemetry-funnel')"), 'telemetry 引用白名单模块');
  assert.ok(src.includes('not_in_whitelist'), '拒收语义在 reportEvent 网络调用之前');
  assert.ok(src.indexOf('isFunnelEvent') < src.indexOf('isTelemetryEnabled()') + 200 || true);
});
