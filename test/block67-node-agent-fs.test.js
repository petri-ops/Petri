/**
 * BLOCK-67 P1 — node-agent fs verbs 零网络测试。
 *
 * 直接在本地 bash 执行 BIOF3_AGENT_SH 脚本体（不走 ssh），验证 fs_* verbs
 * 的行为契约：list/stat/read/write/mkdir/mv/rm + not_found 语义 + base64 传输。
 * 前置：本机有 bash（Windows 指挥席 = Git Bash）与 base64/tail/head。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const { BIOF3_AGENT_SH, remoteAgentCommand } = require('../core/biof3-server/helpers/remote-execution/node-agent');

const execFileP = promisify(execFile);

// BI0F3_AGENT_SH 内部以 $HOME 为锚（AGENT_HOME），测试中无需覆盖。
// 脚本内的 fs verbs 全部以显式绝对路径为参，不触碰 JOBS_DIR。
async function runAgent(args, { env } = {}) {
  const tmpScript = path.join(os.tmpdir(), `block67-agent-${process.pid}-${Date.now()}.sh`);
  fs.writeFileSync(tmpScript, BIOF3_AGENT_SH, 'utf-8');
  try {
    const { stdout } = await execFileP('bash', [tmpScript, ...args], { env: { ...process.env, ...(env || {}) } });
    return stdout;
  } finally {
    fs.rmSync(tmpScript, { force: true });
  }
}

const b64 = (s) => Buffer.from(String(s), 'utf-8').toString('base64');

test('block67 fs verbs: write → stat → read 往返（UTF-8 中文）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block67-fs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'sub', '笔记.md').replace(/\\/g, '/');
  const content = '# 标题\n中文内容 mixed ASCII\n';

  const writeOut = await runAgent(['fs_write', b64(file), b64(content)]);
  assert.strictEqual(JSON.parse(writeOut).type, 'file');
  assert.strictEqual(JSON.parse(writeOut).size, Buffer.byteLength(content));

  const statOut = await runAgent(['fs_stat', b64(file)]);
  const stat = JSON.parse(statOut);
  assert.strictEqual(stat.type, 'file');
  assert.ok(Number.isFinite(stat.mtimeMs));

  const readOut = await runAgent(['fs_read', b64(file)]);
  const decoded = Buffer.from(readOut.replace(/\s+/g, ''), 'base64').toString('utf-8');
  assert.strictEqual(decoded, content);
});

test('block67 fs verbs: list 含目录排序语义条目与隐藏文件过滤', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block67-fs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'aaa');
  fs.mkdirSync(path.join(dir, 'bdir'));
  fs.writeFileSync(path.join(dir, '.hidden'), 'x');

  const out = await runAgent(['fs_list', b64(dir.replace(/\\/g, '/'))]);
  const entries = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const names = entries.map((e) => e.name);
  assert.ok(names.includes('a.txt') && names.includes('bdir'));
  assert.ok(!names.includes('.hidden'));
  const fileEntry = entries.find((e) => e.name === 'a.txt');
  assert.strictEqual(fileEntry.type, 'file');
  assert.strictEqual(fileEntry.size, 3);
  const dirEntry = entries.find((e) => e.name === 'bdir');
  assert.strictEqual(dirEntry.type, 'dir');
});

test('block67 fs verbs: fs_read 偏移+长度窗口', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block67-fs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'w.txt').replace(/\\/g, '/');
  fs.writeFileSync(path.join(dir, 'w.txt'), '0123456789');

  const out = await runAgent(['fs_read', b64(file), '2', '5']);
  const decoded = Buffer.from(out.replace(/\s+/g, ''), 'base64').toString('utf-8');
  assert.strictEqual(decoded, '23456');
});

test('block67 fs verbs: mkdir / mv / rm 链路', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block67-fs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const posix = (p) => p.replace(/\\/g, '/');

  const mkOut = await runAgent(['fs_mkdir', b64(posix(path.join(dir, 'x', 'y')))]);
  assert.strictEqual(JSON.parse(mkOut).type, 'dir');
  assert.ok(fs.existsSync(path.join(dir, 'x', 'y')));

  const src = path.join(dir, 'x', 'y', 'f.txt');
  fs.writeFileSync(src, 'move me');
  const dst = path.join(dir, 'x', 'g.txt');
  const mvOut = await runAgent(['fs_mv', b64(posix(src)), b64(posix(dst))]);
  assert.strictEqual(JSON.parse(mvOut).type, 'file');
  assert.ok(!fs.existsSync(src) && fs.existsSync(dst));

  const rmOut = await runAgent(['fs_rm', b64(posix(path.join(dir, 'x')))]);
  assert.strictEqual(JSON.parse(rmOut).removed, true);
  assert.ok(!fs.existsSync(path.join(dir, 'x')));
});

test('block67 fs verbs: not_found 诚实语义（stat/list/read/rm）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block67-fs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const missing = path.join(dir, 'nope').replace(/\\/g, '/');
  assert.strictEqual(JSON.parse(await runAgent(['fs_stat', b64(missing)])).error, 'not_found');
  assert.strictEqual(JSON.parse(await runAgent(['fs_list', b64(missing)])).error, 'not_found');
  assert.strictEqual(JSON.parse(await runAgent(['fs_read', b64(missing)])).error, 'not_found');
  assert.strictEqual(JSON.parse(await runAgent(['fs_rm', b64(missing)])).error, 'not_found');
});

test('block67 remoteAgentCommand: fs verb 参数经 base64 落在白名单（无注入面）', () => {
  const evilPath = '/tmp/evil; rm -rf / #';
  const cmd = remoteAgentCommand(['fs_stat', b64(evilPath)]);
  assert.ok(cmd.startsWith('bash "$HOME/.biof3-agent/bin/biof3-agent.sh"'));
  assert.ok(!cmd.includes('rm -rf'));
  // 白名单拒绝含空格/引号的裸参数（base64 编码后才可传输）。
  assert.throws(() => remoteAgentCommand(['fs_stat', evilPath]), /remote_agent_arg_unsafe/);
});
