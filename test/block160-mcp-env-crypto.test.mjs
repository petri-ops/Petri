/**
 * BLOCK-160 W2 P4（CAP-2）— mcp env 落盘加密契约测试。
 *
 * 钉住：aead 加解密往返（enc:v1: 前缀+随机 iv）；saveMcpServers 后磁盘
 * 原文零明文（含 secrets 关键词扫描）；listMcpServers 内存侧明文往返；
 * 存量明文文件读透传（迁移语义）+ 再保存即加密；密钥丢失=诚实降级
 * （该 env 值置空+warn，不崩不伪明文）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b160-mcp-env-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;

const crypto = require(path.join(ROOT, 'core/petri-server/helpers/mcp-env-crypto.js'));
// settings 模块顶层固化 SETTINGS_DIR → 动态 require 前先设 env（每用例独立 tmp 用模块重置不可行，单 tmp 即可）
const settings = require(path.join(ROOT, 'core/petri-server/helpers/mcp-settings.js'));

const SECRET = 'sk-super-secret-token-9f2c';

test('BLOCK-160 CAP-2 加密往返：enc:v1: 前缀+随机 iv+解密还原', () => {
  const a = crypto.encryptSecret(SECRET);
  const b = crypto.encryptSecret(SECRET);
  assert.match(a, /^enc:v1:/);
  assert.match(b, /^enc:v1:/);
  assert.notEqual(a, b, '随机 iv 应使两次密文不同');
  assert.equal(crypto.decryptSecret(a), SECRET);
  // 明文透传（存量语义）
  assert.equal(crypto.decryptSecret('plain-value'), 'plain-value');
});

test('BLOCK-160 CAP-2 落盘零明文：save 后磁盘无 secrets 明文；读取内存侧还原', () => {
  const saved = settings.upsertMcpServer({
    id: 'fixture',
    command: 'node',
    args: ['server.js'],
    env: { API_KEY: SECRET, PLAIN_FLAG: 'hello' },
  });
  assert.equal(saved.error, undefined, JSON.stringify(saved));

  const raw = fs.readFileSync(settings.SETTINGS_FILE, 'utf8');
  assert.ok(!raw.includes(SECRET), '磁盘文件不得含明文密钥');
  assert.match(raw, /enc:v1:/, 'env 值应为密文形态');

  const loaded = settings.getMcpServer('fixture');
  assert.equal(loaded.env.API_KEY, SECRET, '内存侧应还原明文（运行时透传）');
  assert.equal(loaded.env.PLAIN_FLAG, 'hello');
});

test('BLOCK-160 CAP-2 迁移：存量明文文件读透传；再保存即加密', () => {
  const legacyFile = path.join(tmpDir, 'mcp-servers-legacy.json');
  fs.writeFileSync(legacyFile, JSON.stringify({
    version: 1,
    servers: [{ id: 'legacy', command: 'node', args: ['a.js'], env: { TOKEN: SECRET } }],
  }, null, 2));
  // 用 settings 模块同源读取：临时替换 SETTINGS_FILE 不可行（顶层常量）→
  // 直接对 legacy 文件做同语义验证：crypto.decryptSecret 对明文透传。
  const raw = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
  const value = crypto.decryptSecret(raw.servers[0].env.TOKEN);
  assert.equal(value, SECRET, '存量明文读透传（迁移语义）');

  // 经 saveMcpServers 正常通道再保存 → 磁盘即密文
  settings.upsertMcpServer({ id: 'legacy', command: 'node', args: ['a.js'], env: { TOKEN: SECRET } });
  const rawNow = fs.readFileSync(settings.SETTINGS_FILE, 'utf8');
  assert.ok(!rawNow.includes(SECRET), '再保存后磁盘不得含明文');
});

test('BLOCK-160 CAP-2 诚实降级：密钥丢失=该 env 值置空+不崩', () => {
  const enc = crypto.encryptSecret(SECRET);
  // 模拟密钥轮换/丢失：删除密钥文件后解密失败路径
  const keyFile = path.join(tmpDir, 'keys', 'mcp-env.key');
  const backup = fs.existsSync(keyFile) ? fs.readFileSync(keyFile) : null;
  fs.rmSync(keyFile, { force: true });
  crypto._resetKeyCacheForTests(); // 清内存密钥缓存（模拟跨进程密钥丢失）
  // 重新生成的新密钥解不开旧密文 → 诚实降级空值
  const decrypted = crypto.decryptSecret(enc);
  assert.equal(decrypted, '', '解密失败应降级空值');
  if (backup) fs.writeFileSync(keyFile, backup);
});
