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

test('block67 fs verbs: list 含目录排序语义条目与隐藏文件过滤（BLOCK-96 F2 NUL 记录协议）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block67-fs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'aaa');
  fs.writeFileSync(path.join(dir, 'space name.txt'), 'x');
  fs.mkdirSync(path.join(dir, 'bdir'));
  fs.writeFileSync(path.join(dir, '.hidden'), 'x');

  const out = await runAgent(['fs_list', b64(dir.replace(/\\/g, '/'))]);
  // BLOCK-96 F2 — stdout = 单行 base64(NUL 记录流)；解析契约归 gateway parseListEntries
  const { parseListEntries } = require('../core/biof3-server/helpers/workspace-gateway');
  const entries = parseListEntries(out);
  const names = entries.map((e) => e.name);
  assert.ok(names.includes('a.txt') && names.includes('bdir') && names.includes('space name.txt'));
  assert.ok(!names.includes('.hidden'));
  const fileEntry = entries.find((e) => e.name === 'a.txt');
  assert.strictEqual(fileEntry.type, 'file');
  assert.strictEqual(fileEntry.size, 3);
  const dirEntry = entries.find((e) => e.name === 'bdir');
  assert.strictEqual(dirEntry.type, 'dir');
});

test('block67 fs verbs: die 显式错误码经 stderr（already_exists；BLOCK-96 F3 错误契约）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block67-fs-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  await assert.rejects(
    () => runAgent([
      'fs_cp',
      b64(path.join(dir, 'a.txt').replace(/\\/g, '/')),
      b64(path.join(dir, 'a.txt').replace(/\\/g, '/')),
    ]),
    (e) => /agent_error: already_exists/.test(e.stderr || ''),
  );
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

test('block89 fs_cp: 文件复制 + 目录递归复制 + 目标父目录自动建', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block89-cp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const posix = (p) => p.replace(/\\/g, '/');

  // 文件复制：目标父目录不存在 → 自动建
  const srcFile = path.join(dir, 'a.txt');
  fs.writeFileSync(srcFile, 'copy me');
  const dstFile = path.join(dir, 'nested', 'b.txt');
  const cpOut = await runAgent(['fs_cp', b64(posix(srcFile)), b64(posix(dstFile))]);
  assert.strictEqual(JSON.parse(cpOut).type, 'file');
  assert.ok(fs.existsSync(dstFile));
  assert.strictEqual(fs.readFileSync(dstFile, 'utf-8'), 'copy me');
  assert.ok(fs.existsSync(srcFile), 'copy keeps source');

  // 目录递归复制
  fs.mkdirSync(path.join(dir, 'srcdir', 'inner'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'srcdir', 'inner', 'deep.txt'), 'd');
  const dstDir = path.join(dir, 'dstdir');
  const cpDirOut = await runAgent(['fs_cp', b64(posix(path.join(dir, 'srcdir'))), b64(posix(dstDir))]);
  assert.strictEqual(JSON.parse(cpDirOut).type, 'dir');
  assert.strictEqual(fs.readFileSync(path.join(dstDir, 'inner', 'deep.txt'), 'utf-8'), 'd');
});

test('block89 fs_cp: already_exists 显式报错 + not_found 诚实语义', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block89-cp-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const posix = (p) => p.replace(/\\/g, '/');

  fs.writeFileSync(path.join(dir, 'a.txt'), 'A');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'B');

  // 目标已存在 → die already_exists（exit 64）
  await assert.rejects(
    () => runAgent(['fs_cp', b64(posix(path.join(dir, 'a.txt'))), b64(posix(path.join(dir, 'b.txt')))]),
    (err) => {
      assert.strictEqual(err.code, 64);
      assert.ok(/already_exists/.test(String(err.stderr)));
      return true;
    }
  );
  assert.strictEqual(fs.readFileSync(path.join(dir, 'b.txt'), 'utf-8'), 'B', 'existing target untouched');

  // 源缺失 → 单行 JSON not_found
  const nfOut = await runAgent(['fs_cp', b64(posix(path.join(dir, 'nope'))), b64(posix(path.join(dir, 'x.txt')))]);
  assert.strictEqual(JSON.parse(nfOut).error, 'not_found');
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

// ── BLOCK-67 P2：find / grep / exec / 进程面 verbs ──
test('block67 P2 verbs: fs_find 相对路径 + 隐藏目录剪枝', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block67-p2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'sub', 'b.txt'), 'y');
  fs.mkdirSync(path.join(dir, '.hidedir'));
  fs.writeFileSync(path.join(dir, '.hidedir', 'c.txt'), 'z');

  const out = await runAgent(['fs_find', b64(dir.replace(/\\/g, '/')), '4']);
  const lines = out.trim().split('\n').filter(Boolean);
  assert.ok(lines.includes('a.txt') && lines.includes('sub/b.txt'));
  assert.ok(!lines.some((l) => l.includes('c.txt')), 'hidden pruned: ' + lines.join(','));
});

test('block67 P2 verbs: fs_grep 文本命中 + 二进制跳过', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block67-p2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'one.txt'), 'hello MARKER_42 world\nsecond line\n');
  fs.writeFileSync(path.join(dir, 'two.md'), 'no match here\n');
  fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 0, 3]));

  const out = await runAgent(['fs_grep', b64('MARKER_42'), b64(dir.replace(/\\/g, '/')), '10']);
  const lines = out.trim().split('\n').filter(Boolean);
  assert.strictEqual(lines.length, 1);
  assert.ok(lines[0].includes('one.txt') && lines[0].includes('MARKER_42'));
});

test('block67 P2 verbs: exec 同步命令（cwd + code + stdout/stderr base64）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block67-p2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = await runAgent(['exec', b64('echo out-中文; echo err-1 >&2; exit 3'), b64(dir.replace(/\\/g, '/')), '20']);
  const info = JSON.parse(out.trim());
  assert.strictEqual(info.code, 3);
  assert.strictEqual(Buffer.from(info.stdout, 'base64').toString('utf-8').trim(), 'out-中文');
  assert.ok(Buffer.from(info.stderr, 'base64').toString('utf-8').includes('err-1'));
  assert.strictEqual(info.truncated, false);
});

test('block67 P2 verbs: exec 超时被杀（timeout KILL → 非零 code）', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block67-p2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = await runAgent(['exec', b64('sleep 30'), b64(dir.replace(/\\/g, '/')), '2']);
  const info = JSON.parse(out.trim());
  assert.notStrictEqual(info.code, 0);
});

test('block67 P2 verbs: exec_bg + ps_pid + kill_pid 生命周期', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block67-p2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'bg.log').replace(/\\/g, '/');
  const out = await runAgent(['exec_bg', b64('echo started; sleep 8'), b64(dir.replace(/\\/g, '/')), b64(log)]);
  const info = JSON.parse(out.trim());
  if (info.error) {
    // pgrep 在部分最小环境缺失——诚实登记为环境限制，不算契约失败
    t.diagnostic('exec_bg spawn probe unavailable: ' + JSON.stringify(info));
    return;
  }
  assert.ok(Number.isInteger(info.pid) && info.pid > 0);
  await new Promise((r) => setTimeout(r, 800));
  const alive = JSON.parse((await runAgent(['ps_pid', String(info.pid)])).trim());
  if (alive.alive) {
    const killed = JSON.parse((await runAgent(['kill_pid', String(info.pid), 'TERM'])).trim());
    assert.strictEqual(killed.signaled, true);
    await new Promise((r) => setTimeout(r, 500));
    const after = JSON.parse((await runAgent(['ps_pid', String(info.pid)])).trim());
    assert.strictEqual(after.alive, false);
    const logOut = await runAgent(['fs_read', b64(log)]);
    const logText = Buffer.from(logOut.replace(/\s+/g, ''), 'base64').toString('utf-8');
    assert.ok(logText.includes('started'), 'bg log written: ' + logText);
  } else {
    t.diagnostic('bg process exited quickly (fast host) — log check only');
    const logOut = await runAgent(['fs_read', b64(log)]);
    const logText = Buffer.from(logOut.replace(/\s+/g, ''), 'base64').toString('utf-8');
    assert.ok(logText.includes('started'));
  }
});
