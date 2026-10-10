/**
 * BLOCK-67 加映（UI-326）— IP+密码 引导连接 零网络测试。
 * 覆盖：输入校验 fail-closed / 别名生成 / ssh config upsert（幂等/冲突/新建）/
 * 密码提示状态机（password 提示/known_hosts yes-no/permission denied）。
 * 不触网：ensureKeyPair 以注入 run 打桩；pty 流程不做单测（实机验证）。
 */
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  validateRegisterInput,
  generateAlias,
  upsertSshConfig,
  sshConfigPath,
  ensureKeyPair,
  nextPromptAction,
} = require('../src/ipc/ssh-host.js');

afterEach(() => {});

test('validateRegisterInput: 全字段 fail-closed', () => {
  const good = validateRegisterInput({ ip: '47.110.228.168', port: 22, username: 'root', password: 'x' });
  assert.strictEqual(good, null);
  assert.ok(validateRegisterInput({ ip: 'a b', port: 22, username: 'root', password: 'x' }));
  assert.ok(validateRegisterInput({ ip: '1.2.3.4', port: 0, username: 'root', password: 'x' }));
  assert.ok(validateRegisterInput({ ip: '1.2.3.4', port: 70000, username: 'root', password: 'x' }));
  assert.ok(validateRegisterInput({ ip: '1.2.3.4', port: 22, username: 'ro ot', password: 'x' }));
  assert.ok(validateRegisterInput({ ip: '1.2.3.4', port: 22, username: 'root', password: '' }));
  assert.ok(validateRegisterInput({ ip: '1.2.3.4@evil', port: 22, username: 'root', password: 'x' }));
});

test('generateAlias: ip 归一 + 非 22 端口后缀', () => {
  assert.strictEqual(generateAlias('47.110.228.168', 22), 'petri-47-110-228-168');
  assert.strictEqual(generateAlias('47.110.228.168', 6022), 'petri-47-110-228-168-6022');
  assert.ok(/^[A-Za-z0-9._-]+$/.test(generateAlias('example.server.cn', 22)));
});

test('upsertSshConfig: 新建 / 幂等 / 别名冲突拒绝 / 不覆盖其他条目', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b67-sshcfg-'));
  try {
    const cfg = join(dir, 'config');
    writeFileSync(cfg, 'Host oldbox\n  HostName 10.0.0.1\n  User admin\n');

    const r1 = upsertSshConfig(cfg, 'petri-1-2-3-4', '1.2.3.4', 22, 'root');
    assert.strictEqual(r1.ok, true);
    let text = readFileSync(cfg, 'utf8');
    assert.ok(text.includes('Host petri-1-2-3-4') && text.includes('HostName 1.2.3.4'));
    assert.ok(text.includes('Host oldbox'), '既有条目保留');

    const r2 = upsertSshConfig(cfg, 'petri-1-2-3-4', '1.2.3.4', 22, 'root');
    assert.strictEqual(r2.ok, true);
    assert.strictEqual(r2.alreadyRegistered, true);

    const r3 = upsertSshConfig(cfg, 'petri-1-2-3-4', '5.6.7.8', 22, 'root');
    assert.strictEqual(r3.ok, false);
    assert.match(r3.message, /已存在/);

    const r4 = upsertSshConfig(cfg, 'petri-5-6-7-8', '5.6.7.8', 6022, 'dev');
    assert.strictEqual(r4.ok, true);
    text = readFileSync(cfg, 'utf8');
    assert.ok(text.includes('Port 6022') && text.includes('User dev'));
    assert.ok(text.includes('Host oldbox') && text.includes('Host petri-1-2-3-4'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ensureKeyPair: 已有公钥直接返回；无则调用注入的 keygen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'b67-key-'));
  try {
    let keygenCalls = 0;
    const pub1 = ensureKeyPair({
      sshDir: dir,
      run: (bin, args) => {
        keygenCalls += 1;
        assert.strictEqual(bin, 'ssh-keygen');
        assert.ok(args.includes('ed25519'));
        writeFileSync(join(dir, 'id_ed25519.pub'), 'ssh-ed25519 AAAA test\n');
      },
    });
    assert.strictEqual(keygenCalls, 1);
    assert.ok(pub1.startsWith('ssh-ed25519'));
    const pub2 = ensureKeyPair({ sshDir: dir, run: () => { keygenCalls += 1; } });
    assert.strictEqual(keygenCalls, 1, '已有公钥不再生成');
    assert.strictEqual(pub2, pub1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('nextPromptAction: 密码提示 / host 确认 / permission denied / 等待', () => {
  assert.strictEqual(nextPromptAction('root@1.2.3.4\'s password: ').action, 'write');
  assert.ok(nextPromptAction("root@1.2.3.4's password: ").text.includes('__PASSWORD__'));
  assert.strictEqual(nextPromptAction('Are you sure you want to continue connecting (yes/no/[fingerprint])?').action, 'write');
  assert.strictEqual(nextPromptAction('Permission denied, please try again.').action, 'fail');
  assert.strictEqual(nextPromptAction('Connecting to 1.2.3.4...').action, 'wait');
});

test('sshConfigPath: home 注入', () => {
  assert.strictEqual(sshConfigPath('/home/u'), join('/home/u', '.ssh', 'config'));
});
