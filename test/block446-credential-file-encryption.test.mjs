import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

/**
 * BLOCK-446 凭据 file 后端加密化 + 错误语义分离（ZCode v3.18.2 systemCredentialCipher 借鉴落地）。
 *
 * 交付契约（plan=docs/block-446-credential-file-encryption-plan.md §2/§6）：
 * 1. 落盘零明文：file 后端 set() 的值一律 enc:v1（AES-256-GCM，复用 mcp-env-crypto 单源）；
 * 2. 存量迁移：明文透传可读，get 命中含明文的文件时整组急切迁移（fail-open 不丢值）；
 * 3. 错误语义分离：文件缺失=干净空态；损坏/不可读=存储错误态（get→''+warn 不崩，
 *    set→fail-closed 抛错拒覆写【防毁他 provider 密文】，remove→文件零触碰）；
 * 4. 值不可解（密钥丢失/密文损坏）：该值诚实 ''，密文保留在盘，他条目写时保留；
 * 5. status() 三态健康面（ok/corrupt/unreadable）。
 */

const require = createRequire(import.meta.url);
const { createCredentialStore } = require('../core/petri-server/helpers/credential-store.js');
const { _resetKeyCacheForTests } = require('../core/petri-server/helpers/mcp-env-crypto.js');

// BLOCK-439 教训：测试不得触碰真实凭据面——密钥/凭据全部隔离在临时数据根。
function isolatedRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block446-'));
  process.env.PETRI_LOCAL_DATA_DIR = root;
  _resetKeyCacheForTests();
  return root;
}

function rawFile(store) {
  return fs.readFileSync(store.filePath, 'utf8');
}

test('file 后端 set() 落盘零明文：raw 文件无明文子串、值形态 enc:v1、get() 往返明文', () => {
  const root = isolatedRoot();
  const store = createCredentialStore({ settingsDir: root, backend: 'file', platform: 'linux' });

  store.set('openai', 'secret-value-446');

  const raw = rawFile(store);
  assert.equal(raw.includes('secret-value-446'), false, '落盘明文即红（BLOCK-446 G1）');
  assert.match(raw, /enc:v1:/, '落盘值必须是 enc:v1 密文形态');
  assert.equal(store.get('openai'), 'secret-value-446', '解密往返必须还原明文');
  assert.equal(store.isConfigured('openai'), true);
});

test('存量明文透传可读，get 命中后整组急切迁移（迁移后 raw 零明文且值不变）', () => {
  const root = isolatedRoot();
  const store = createCredentialStore({ settingsDir: root, backend: 'file', platform: 'linux' });
  fs.writeFileSync(store.filePath, JSON.stringify({ dashscope: 'sk-legacy-446' }), { mode: 0o600 });

  // 读取路径 = 明文透传（迁移语义与 mcp-env-crypto 一致）
  assert.equal(store.get('dashscope'), 'sk-legacy-446');

  // 急切迁移：读后 raw 零明文，且往返仍成立
  const rawAfter = rawFile(store);
  assert.equal(rawAfter.includes('sk-legacy-446'), false, '迁移后落盘仍残留明文即红');
  assert.match(rawAfter, /enc:v1:/);
  assert.equal(store.get('dashscope'), 'sk-legacy-446', '迁移后解密往返必须成立');
});

test('多 provider 并存：各自加密、互不覆盖、整组保留', () => {
  const root = isolatedRoot();
  const store = createCredentialStore({ settingsDir: root, backend: 'file', platform: 'linux' });

  store.set('lab-a', 'key-a-446');
  store.set('lab-b', 'key-b-446');

  const raw = rawFile(store);
  assert.equal(raw.includes('key-a-446'), false);
  assert.equal(raw.includes('key-b-446'), false);
  assert.equal((raw.match(/enc:v1:/g) || []).length >= 2, true, '两个 provider 各自持密文');
  assert.equal(store.get('lab-a'), 'key-a-446');
  assert.equal(store.get('lab-b'), 'key-b-446');
});

test('损坏文件 fail-closed：set() 抛错拒覆写、文件字节不变；get() 诚实空串不崩；status()=corrupt', () => {
  const root = isolatedRoot();
  const store = createCredentialStore({ settingsDir: root, backend: 'file', platform: 'linux' });
  const corrupted = '{"openai": "enc:v1:aa.bb.cc", "trunc';
  fs.writeFileSync(store.filePath, corrupted, { mode: 0o600 });
  const before = fs.statSync(store.filePath).mtimeMs;

  assert.throws(() => store.set('new-provider', 'key-new-446'), /损坏|corrupt|fail-closed|拒绝写入/,
    '损坏文件上写入必须 fail-closed（防单条目覆盖毁掉他 provider 密文）');
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), corrupted, '拒写时文件字节零触碰');
  assert.equal(fs.statSync(store.filePath).mtimeMs, before);

  assert.equal(store.get('openai'), '', '损坏文件读取诚实空串（不崩、不伪装可用）');
  const st = store.status();
  assert.equal(st.ok, false);
  assert.equal(st.error, 'corrupt');
});

if (process.platform !== 'win32') {
  test('不可读文件 fail-closed：set() 抛错、get() 空串、status()=unreadable（Unix 权限语义）', () => {
    const root = isolatedRoot();
    const store = createCredentialStore({ settingsDir: root, backend: 'file', platform: 'linux' });
    store.set('keeper', 'keeper-value-446');
    const rawBefore = rawFile(store);
    fs.chmodSync(store.filePath, 0o000);

    try {
      assert.throws(() => store.set('intruder', 'nope-446'), /不可读|unreadable|拒绝写入/);
      assert.equal(store.get('keeper'), '', '不可读=存储错误态，诚实空串');
      const st = store.status();
      assert.equal(st.ok, false);
      assert.equal(st.error, 'unreadable');
    } finally {
      fs.chmodSync(store.filePath, 0o600);
    }
    assert.equal(rawFile(store), rawBefore, '失败路径文件零触碰');
    assert.equal(store.get('keeper'), 'keeper-value-446', '恢复权限后原值完好');
  });
}

test('status() 三态：缺失=ok/fileExists:false；正常=ok；损坏=corrupt', () => {
  const root = isolatedRoot();
  const store = createCredentialStore({ settingsDir: root, backend: 'file', platform: 'linux' });

  const missing = store.status();
  assert.equal(missing.backend, 'file');
  assert.equal(missing.fileExists, false);
  assert.equal(missing.ok, true, '文件不存在=干净空态，不是错误');
  assert.equal(missing.error, null);

  store.set('p', 'v-446');
  const ok = store.status();
  assert.equal(ok.fileExists, true);
  assert.equal(ok.ok, true);
  assert.equal(ok.error, null);

  fs.writeFileSync(store.filePath, 'not-json{{{', { mode: 0o600 });
  const bad = store.status();
  assert.equal(bad.ok, false);
  assert.equal(bad.error, 'corrupt');
});

test('值不可解：密文坏值诚实空串且保留在盘；他条目写时原样保留、明文邻居同时迁移', () => {
  const root = isolatedRoot();
  const store = createCredentialStore({ settingsDir: root, backend: 'file', platform: 'linux' });
  const broken = 'enc:v1:00.00.00deadbeef';
  fs.writeFileSync(store.filePath, JSON.stringify({
    broken: broken,
    plain: 'sk-plain-446',
  }), { mode: 0o600 });

  assert.equal(store.get('broken'), '', '不可解密文诚实空串（密钥丢失/密文损坏）');
  assert.equal(store.get('plain'), 'sk-plain-446');

  store.set('fresh', 'fresh-446'); // 写路径不得丢弃 broken 的密文

  const raw = rawFile(store);
  assert.equal(raw.includes(broken), true, '不可解密文必须保留（不得静默销毁他条目）');
  assert.equal(raw.includes('sk-plain-446'), false, '明文邻居随写入整组迁移');
  assert.equal(store.get('fresh'), 'fresh-446');
  assert.equal(store.get('broken'), '');
});

test('remove() 在损坏文件上零触碰、不崩；正常路径 remove 后条目消失且他条目保留', () => {
  const root = isolatedRoot();
  const store = createCredentialStore({ settingsDir: root, backend: 'file', platform: 'linux' });

  store.set('a', 'va-446');
  store.set('b', 'vb-446');
  store.remove('a');
  assert.equal(store.get('a'), '');
  assert.equal(store.get('b'), 'vb-446', '删除单条不得影响他条目');

  fs.writeFileSync(store.filePath, 'garbage{{{', { mode: 0o600 });
  assert.doesNotThrow(() => store.remove('b'), '损坏文件上 remove 不崩');
  assert.equal(fs.readFileSync(store.filePath, 'utf8'), 'garbage{{{', '损坏文件上 remove 零触碰');
});

test('keychain 后端不受影响：往返语义不变、status() 结构字段齐全', () => {
  const calls = [];
  const execFileSync = (command, args) => {
    calls.push({ command, args });
    return args[0] === 'find-generic-password' ? 'keychain-secret-446\n' : '';
  };
  const store = createCredentialStore({
    settingsDir: '/unused', backend: 'keychain', platform: 'darwin', execFileSync,
  });

  store.set('anthropic', 'new-secret-446');
  assert.equal(store.get('anthropic'), 'keychain-secret-446');
  const st = store.status();
  assert.equal(st.backend, 'keychain');
  assert.equal(st.error, null);
});
