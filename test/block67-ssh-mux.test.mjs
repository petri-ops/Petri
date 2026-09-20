/**
 * BLOCK-67 加映（D1.1）— ssh-multiplexer 协议零网络测试。
 *
 * 用本地 bash 执行 agent 的 __mux 循环（不经 ssh），验证客户端会话：
 * 命令投递 / R 行解析 / 多请求串行 / fs_write 大载荷 / 会话死亡后拒绝。
 * agent 脚本以临时 HOME 部署（$HOME/.biof3-agent/bin/biof3-agent.sh），
 * 使 remoteAgentCommand 的 "$HOME/..." 在本地成立。
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { BIOF3_AGENT_SH, agentVersionHash, remoteAgentCommand } = require('../core/biof3-server/helpers/remote-execution/node-agent');
const mux = require('../core/biof3-server/helpers/remote-execution/ssh-multiplexer');
// BLOCK-96 F2 — fs_list 契约断言经 gateway 解码（stdout = 单行 base64(NUL 记录流)）
const { parseListEntries } = require('../core/biof3-server/helpers/workspace-gateway');

// 临时 HOME 部署 agent（与远端布局一致）
const fakeHome = mkdtempSync(join(tmpdir(), 'b67-mux-'));
const agentDir = join(fakeHome, '.biof3-agent', 'bin');
mkdirSync(agentDir, { recursive: true });
const agentPath = join(agentDir, 'biof3-agent.sh');
writeFileSync(agentPath, BIOF3_AGENT_SH);
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;

function localSpawn() {
  // 本地 bash 执行 __mux 循环（HOME 已指向 fakeHome）
  return spawn('bash', [agentPath, '__mux'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: fakeHome } });
}

after(() => { mux.closeAll(); try { rmSync(fakeHome, { recursive: true, force: true }); } catch {} });

test('mux 会话: fs verbs 在复用连接上往返（list/write/read）', {
  // list 腿依赖 GNU find -printf（同 block67-node-agent-fs list 用例平台门）
  skip: process.platform === 'darwin' && 'macOS BSD find 无 -printf（list 腿依赖 GNU find；语义面由 Linux 节点 / Windows Git Bash 覆盖）',
}, async () => {
  const root = join(fakeHome, 'proj').replace(/\\/g, '/');
  const session = mux.createMuxSession({ alias: 'test', spawnFn: localSpawn });

  await session.run(remoteAgentCommand(['fs_mkdir', Buffer.from(root).toString('base64')]), 20000);
  await session.run(remoteAgentCommand(['fs_write', Buffer.from(root + '/a.md').toString('base64'), Buffer.from('# 内容甲').toString('base64')], { maxArgLen: 2 * 1024 * 1024 }), 20000);

  const listRaw = await session.run(remoteAgentCommand(['fs_list', Buffer.from(root).toString('base64')]), 20000);
  // BLOCK-96 F2 — stdout 为单行 base64(NUL 记录流)；解码后名称可见
  const listNames = parseListEntries(listRaw.stdout).map((e) => e.name);
  assert.ok(listNames.includes('a.md'), JSON.stringify(listNames));

  const readRaw = await session.run(remoteAgentCommand(['fs_read', Buffer.from(root + '/a.md').toString('base64')]), 20000);
  const content = Buffer.from(readRaw.stdout.replace(/\s+/g, ''), 'base64').toString('utf-8');
  assert.strictEqual(content, '# 内容甲');

  // 多请求串行：连续 20 次小操作全部成功
  for (let i = 0; i < 20; i += 1) {
    const r = await session.run(remoteAgentCommand(['fs_stat', Buffer.from(root + '/a.md').toString('base64')]), 20000);
    assert.ok(r.stdout.includes('"type":"file"'));
  }
  assert.ok(existsSync(root + '/a.md'.replace(/\//g, require('node:path').sep)) || existsSync(root + '/a.md'));
});

test('mux 会话: exec verb 单行 JSON 透传', async () => {
  const session = mux.getMuxSession({ alias: 'test', spawnFn: localSpawn });
  const out = await session.run(remoteAgentCommand(['exec', Buffer.from('echo mux-echo-31337').toString('base64'), Buffer.from(fakeHome).toString('base64'), '20'], { maxArgLen: 2 * 1024 * 1024 }), 30000);
  // exec verb 的 stdout = 单行 JSON（内层 stdout 为 base64）——网关层解码后语义不变
  const inner = JSON.parse(out.stdout.trim());
  assert.strictEqual(inner.code, 0);
  assert.ok(Buffer.from(inner.stdout, 'base64').toString('utf-8').includes('mux-echo-31337'));
});

test('mux 会话: die 错误码经 envelope stderr 字段回传（BLOCK-96 F3）', async () => {
  const session = mux.getMuxSession({ alias: 'test', spawnFn: localSpawn });
  // fs_cp 目标已存在 → die already_exists（exit 64）：envelope 第 4 字段携带 stderr(b64)
  // 自建前置（勿依赖 fs verbs 用例的副作用——该用例在 macOS 平台门下可能被 skip）
  const projDir = join(fakeHome, 'proj');
  mkdirSync(projDir, { recursive: true });
  const aMd = join(projDir, 'a.md').replace(/\\/g, '/');
  writeFileSync(aMd, '# 内容甲');
  const r = await session.run(remoteAgentCommand([
    'fs_cp',
    Buffer.from(aMd).toString('base64'),
    Buffer.from(aMd).toString('base64'),
  ]), 20000);
  assert.strictEqual(r.code, 64);
  assert.ok(r.stderr.includes('agent_error: already_exists'), JSON.stringify(r.stderr));
});

test('runOnMux: 非零 exit 仍返回 stdout（语义交调用方）+ muxEnabled 开关', async () => {
  const r = await mux.runOnMux({ alias: 'test', command: remoteAgentCommand(['fs_stat', Buffer.from('/nope/xyz').toString('base64')]), spawnFn: localSpawn, timeoutMs: 20000 });
  assert.strictEqual(r.code, 0); // agent fs_stat not_found 走 stdout JSON、exit 0
  assert.ok(r.stdout.includes('not_found'));

  const orig = process.env.BIOF3_SSH_MUX;
  process.env.BIOF3_SSH_MUX = '0';
  assert.strictEqual(mux.muxEnabled(), false);
  if (orig === undefined) delete process.env.BIOF3_SSH_MUX; else process.env.BIOF3_SSH_MUX = orig;
});

test('mux 会话死亡: pending 与后续请求诚实拒绝（可重试）', async () => {
  const session = mux.createMuxSession({ alias: 'die-test', spawnFn: localSpawn });
  await session.run(remoteAgentCommand(['fs_stat', Buffer.from('/x').toString('base64')]), 20000);
  session.child.kill(); // 模拟连接断开
  await new Promise((r) => setTimeout(r, 300));
  await assert.rejects(
    () => session.run(remoteAgentCommand(['fs_stat', Buffer.from('/x').toString('base64')]), 20000),
    (e) => e.classified && e.classified.retryable === true,
  );
});
