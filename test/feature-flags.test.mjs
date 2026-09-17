// 灰度功能开关（feature-flags）契约测试 — 2026-09-18 用户裁决「翻默认+设置页开关」
// 跑法：node --test test/feature-flags.test.mjs
// 解析优先级：env 强制覆盖（1/true 开，0/false 关）> 设置页持久化 > 默认开。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-flags-'));
process.env.BIOF3_LOCAL_DATA_DIR = tempRoot;
process.on('exit', () => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});

const ff = require('../core/biof3-server/helpers/feature-flags.js');

test('默认值：三开关全部默认开（2026-09-18 用户裁决翻默认）', () => {
  const env = {};
  assert.equal(ff.resolveFlag('server_history_assembly', env), true);
  assert.equal(ff.resolveFlag('session_compaction', env), true);
  assert.equal(ff.resolveFlag('agent_resilience', env), true);
});

test('env 强制覆盖：1/true 强开、0/false 强关（kill-switch 语义不变）', () => {
  assert.equal(ff.resolveFlag('agent_resilience', { BIOF3_AGENT_RESILIENCE: '1' }), true);
  assert.equal(ff.resolveFlag('agent_resilience', { BIOF3_AGENT_RESILIENCE: 'true' }), true);
  assert.equal(ff.resolveFlag('agent_resilience', { BIOF3_AGENT_RESILIENCE: '0' }), false);
  assert.equal(ff.resolveFlag('agent_resilience', { BIOF3_AGENT_RESILIENCE: 'false' }), false);
  // 非强制值（如 'yes'）不覆盖 → 走持久化/默认
  assert.equal(ff.resolveFlag('agent_resilience', { BIOF3_AGENT_RESILIENCE: 'yes' }), true);
});

test('设置页持久化：显式选择生效，env 强制优先于持久化', () => {
  ff.setFlag('session_compaction', false);
  assert.equal(ff.resolveFlag('session_compaction', {}), false, 'persisted off wins over default');
  assert.equal(
    ff.resolveFlag('session_compaction', { BIOF3_SESSION_COMPACTION: '1' }),
    true,
    'env force-on beats persisted off',
  );
  assert.equal(
    ff.resolveFlag('session_compaction', { BIOF3_SESSION_COMPACTION: '0' }),
    false,
    'env force-off beats persisted on',
  );
  ff.setFlag('session_compaction', true);
  assert.equal(ff.resolveFlag('session_compaction', {}), true);
});

test('快照投影：enabled/envOverride/stored/default 齐全，设置页可诚实标注 env 锁定', () => {
  const snapshot = ff.getFlagsSnapshot({ BIOF3_AGENT_RESILIENCE: '0' });
  assert.equal(snapshot.agent_resilience.enabled, false);
  assert.equal(snapshot.agent_resilience.envOverride, false, 'env lock surfaced');
  assert.equal(snapshot.session_compaction.envOverride, null);
  assert.equal(snapshot.session_compaction.default, true);
  assert.ok(snapshot.server_history_assembly.label.length > 0);
  assert.ok(snapshot.session_compaction.description.length > 0);
});

test('未知开关 / 非布尔值 fail-closed', () => {
  assert.throws(() => ff.resolveFlag('no_such_flag', {}), /feature_flag_unknown/);
  assert.throws(() => ff.setFlag('no_such_flag', true), /feature_flag_unknown/);
  assert.throws(() => ff.setFlag('agent_resilience', 'yes'), /feature_flag_value_invalid/);
});
