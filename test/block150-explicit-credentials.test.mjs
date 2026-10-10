import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * BLOCK-150 加映（用户裁决 2026-10-09「杜绝走 env 这个就应该显式的设置」）：
 * 桌面版凭据唯一来源 = 设置页（credential store）。env 兜底路移除——
 * 隐性 env 通道正是「栈重启链路不同→识图时好时坏」的根因。
 * 子进程注入 PETRI_LOCAL_DATA_DIR + DASHSCOPE_API_KEY 隔离验证。
 */
function probeWithStore(storeJson, extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cred-'));
  fs.writeFileSync(path.join(tmp, 'ai-credentials.json'), storeJson);
  fs.writeFileSync(path.join(tmp, 'ai-settings.json'), '{}');
  const out = execFileSync(process.execPath, ['-e',
    "const m=require('./core/petri-server/helpers/ai-settings.js');process.stdout.write(m.getApiKey('dashscope'))",
  ], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, PETRI_LOCAL_DATA_DIR: tmp, ...extraEnv },
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  return out.toString();
}

test('env 兜底已移除：env 有 DASHSCOPE_API_KEY 而存储无该键 → 空串（显式配置唯一来源）', () => {
  const got = probeWithStore('{"deepseek":"sk-store-deepseek"}', { DASHSCOPE_API_KEY: 'env-secret-must-be-ignored' });
  assert.equal(got, '', 'env 值不得再成为凭据来源——泄漏 env 通道即测试红');
});

test('存储路径保持：store 有 dashscope → 返回存储值（与 env 无关）', () => {
  const got = probeWithStore('{"dashscope":"sk-store-dashscope"}', { DASHSCOPE_API_KEY: 'env-secret' });
  assert.equal(got, 'sk-store-dashscope');
});
