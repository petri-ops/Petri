/**
 * RW-05（收缩后单件）— 存储能力协商契约（红绿先行）。
 *
 * 契约（docs/remaining-work-execution-plan.md §3.5 收缩定版）：
 * 1. declareStorageCapabilities(name, caps)：适配器声明 supports_* 能力位
 * 2. getStorageCapabilities(name) / getActiveStorageCapabilities()：消费方查询
 * 3. 未声明能力位 = 不授予（开放词汇表，未知键 fail-closed 忽略）
 * 4. local 适配器声明：直传/删除=true；presigned/服务端复制/留存策略=false（诚实）
 * 5. REST 面：GET /api/storage/capabilities
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// 存储注册发生在 initSharedBackend（与生产同路径）；测试显式初始化
const { initSharedBackend } = require('../core/shared-backend/init');
try { initSharedBackend(); } catch { /* 幂等：重复注册拒绝即视为已初始化 */ }
const storage = require('../core/shared-backend/storage');

test('RW05 能力协商：local 适配器声明诚实能力位', () => {
  const caps = storage.getStorageCapabilities('local');
  assert.ok(caps, 'local 必须有声明');
  assert.equal(caps.name, 'local');
  assert.equal(caps.supportsDirectUpload, true);
  assert.equal(caps.supportsDelete, true);
  assert.equal(caps.supportsPresignedUrl, false, '本地存储无 presigned 语义');
  assert.equal(caps.supportsServerSideCopy, false);
  assert.equal(caps.supportsRetentionPolicy, false);
});

test('RW05 能力协商：活跃适配器查询 + 未声明适配器拒绝', () => {
  const active = storage.getActiveStorageCapabilities();
  assert.ok(active);
  assert.equal(active.name, storage.getActiveStorage().name || 'local');
  assert.throws(() => storage.getStorageCapabilities('nonexistent'), /未注册|not registered/i);
});

test('RW05 能力协商：开放词汇表——未知键忽略（fail-closed 不授予）', () => {
  // 自定义适配器声明含未知键 → 未知键不出现在查询结果
  storage.registerStorage('rw05-probe', {
    upload: async () => '', getUrl: () => '', download: async () => {}, delete: async () => {},
    getUploadUrl: () => '',
  });
  storage.declareStorageCapabilities('rw05-probe', {
    supportsDirectUpload: true,
    supportsTimeTravel: true,
  });
  const caps = storage.getStorageCapabilities('rw05-probe');
  assert.equal(caps.supportsDirectUpload, true);
  assert.equal(caps.supportsTimeTravel, undefined, '未知能力位不授予');
});

test('RW05 能力协商：REST 面 GET /api/storage/capabilities', async () => {
  // 轻量启动：直接走 express 注册（不启全栈）
  const express = require('express');
  const app = express();
  const { registerStorageCapabilitiesRoute } = require('../core/petri-server/routes/storage-capabilities');
  registerStorageCapabilitiesRoute(app);
  const server = app.listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/api/storage/capabilities`);
  const data = await response.json();
  server.close();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.active, 'local');
  assert.equal(data.capabilities.supportsDirectUpload, true);
});
