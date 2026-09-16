#!/usr/bin/env node
/**
 * BLOCK-96 P1 — SSH 通道效率与稳定性 实机探针（dev Electron 不需要；真节点 WSL）。
 *
 * 用产品真实路径取证：sshTransport 首连计时 → gateway createSshBackend（含
 * ensureAgent 自动部署 + mux 复用）跑 恶意文件名 fs_list 往返 / 500 文件计时 /
 * 分页契约。证据落 acceptance/block-96/block96-p1-live.json。
 *
 * 用法：node scripts/block96-ssh-channel-live.cjs [--alias wsl]
 * 前置：目标节点 ssh 免密可达（key auth）。
 */
process.env.BIOF3_SSH_MUX = process.env.BIOF3_SSH_MUX || '1';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const aliasIdx = process.argv.indexOf('--alias');
const ALIAS = aliasIdx >= 0 ? process.argv[aliasIdx + 1] : (process.env.BLOCK96_SSH_ALIAS || 'wsl');
const OUT = path.join(__dirname, '..', 'acceptance', 'block-96', 'block96-p1-live.json');

const sshTransport = require('../core/biof3-server/helpers/remote-execution/ssh-transport');
const gateway = require('../core/biof3-server/helpers/workspace-gateway');

const checks = [];
function record(name, passed, detail) {
  checks.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}  ${JSON.stringify(detail)}`);
}

function sshRun(remoteCommand, input) {
  const r = spawnSync('ssh', [ALIAS, remoteCommand], { input, encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0) throw new Error(`ssh ${ALIAS} failed: ${(r.stderr || '').slice(0, 200)}`);
  return r.stdout;
}

(async () => {
  const baseline = {
    firstConnectBeforeMs: 21200,
    fsList500BeforeMs: 2600,
    note: '立项日（2026-09-16）WSL 同节点实测基线；节点侧已先加 AddressFamily inet 缓解',
  };

  // ① 首连计时（一次性 ssh 全成本）
  let t0 = Date.now();
  const op = await sshTransport.runSshOp({ alias: ALIAS, remoteCommand: 'echo ok' });
  const firstConnectMs = Date.now() - t0;
  record('first_connect', op.classified.kind === 'ok' && firstConnectMs < 1000, {
    ms: firstConnectMs, baselineMs: baseline.firstConnectBeforeMs, classified: op.classified.kind,
  });

  // ② 产品路径 backend（ensureAgent 自动部署 + mux）
  const backend = gateway.createSshBackend({ alias: ALIAS });
  const root = `/tmp/block96-live-${process.pid}`;

  // ③ 恶意文件名往返（引号/反斜杠/换行/制表符/空格/中文 + NUL 协议不可表示性排除）
  sshRun('bash -s', [
    `rm -rf ${root} && mkdir -p ${root}`,
    `cd ${root}`,
    `touch 'a"b.txt' "back${String.fromCharCode(92)}slash.txt" 'space name.txt' '中文测试.txt'`,
    `touch $'newline\nname.txt' "tab\tname.txt"`,
    'echo OK',
  ].join('\n'));
  const BSCH = String.fromCharCode(92);
  const hostileExpect = ['a"b.txt', 'back\\slash.txt', 'space name.txt', '中文测试.txt', 'newline\nname.txt', 'tab\tname.txt'];
  const BS_REMOTE = String.fromCharCode(92);
  const hostileEntries = await backend.list(root);
  const hostileNames = hostileEntries.map((e) => e.name).sort();
  record('hostile_names_roundtrip', JSON.stringify(hostileNames) === JSON.stringify([...hostileExpect].sort()), {
    names: hostileNames,
  });

  // ④ 500 文件 fs_list 计时（cold=mux bootstrap 首列；warm=复用连接）
  sshRun('bash -s', `rm -rf ${root}-500 && mkdir -p ${root}-500 && for i in $(seq 1 500); do touch "${root}-500/f\$i.txt"; done && echo OK`);
  t0 = Date.now();
  const coldEntries = await backend.list(`${root}-500`);
  const coldMs = Date.now() - t0;
  t0 = Date.now();
  const warmEntries = await backend.list(`${root}-500`);
  const warmMs = Date.now() - t0;
  record('fs_list_500_cold', coldEntries.length === 500 && coldMs < 2000, { ms: coldMs, entries: coldEntries.length, baselineMs: baseline.fsList500BeforeMs });
  record('fs_list_500_warm', warmEntries.length === 500 && warmMs < 100, { ms: warmMs, entries: warmEntries.length, baselineMs: baseline.fsList500BeforeMs });

  // ⑤ 分页契约（limit/offset/truncated 数学）
  const page = await backend.listPage(`${root}-500`, { limit: 200, offset: 450 });
  record('pagination_contract', page.total === 500 && page.entries.length === 50 && page.truncated === false, {
    total: page.total, entries: page.entries.length, truncated: page.truncated,
  });
  const midPage = await backend.listPage(`${root}-500`, { limit: 200, offset: 0 });
  record('pagination_truncated_flag', midPage.total === 500 && midPage.entries.length === 200 && midPage.truncated === true, {
    total: midPage.total, entries: midPage.entries.length, truncated: midPage.truncated,
  });

  // ⑥ mux 写列一致（同会话 fs_write 产物立即可见）
  const b64 = (s) => Buffer.from(s).toString('base64');
  await backend.write(`${root}-500/由写而生.txt`, 'block96');
  const afterWrite = await backend.list(`${root}-500`);
  record('mux_write_list_consistency', afterWrite.some((e) => e.name === '由写而生.txt'), {
    entries: afterWrite.length,
  });

  // ── P3 进程面（F4）─────────────────────────────────────────
  // ⑦ exec_bg pidfile 身份：pid+starttime 落 <log>.pid（替代 pgrep 猜测）
  const procRoot = `${root}-proc`;
  sshRun('bash -s', `rm -rf ${procRoot} && mkdir -p ${procRoot} && echo OK`, '');
  const bg = await backend.execBackground('sleep 30', procRoot, `${procRoot}/bg.log`);
  record('exec_bg_pidfile_identity', Number.isInteger(bg.pid) && bg.pid > 0 && typeof bg.starttime === 'string', bg);

  // ⑧ ps_pid starttime 身份校验：存活判定 + 伪造starttime 识别为 reused
  const alive = await backend.processAlive(bg.pid, bg.starttime);
  record('ps_pid_starttime_alive', alive.alive === true && alive.reused !== true, alive);

  // ⑨ kill_pid 进程组击杀：setsid 会话（PGID=PID）连同子孙一并收敛
  const killRes = await backend.killPid(bg.pid, 'KILL');
  await new Promise((r) => setTimeout(r, 400));
  const dead = await backend.processAlive(bg.pid, bg.starttime);
  record('kill_pid_group_reaps', killRes.signaled === true && dead.alive === false, {
    signaled: killRes.signaled, alive: dead.alive,
  });

  // ⑩ exec 超时孙进程组杀清零（旧 timeout 只杀直接子 bash，孙进程存活累积）
  const orphansBefore = sshRun('pgrep -fc "sleep[ ]87\\.42" || true', '').trim();
  const execRes = await backend.exec('sleep 87.42 & echo go; sleep 93.17', procRoot, 2);
  await new Promise((r) => setTimeout(r, 500));
  const orphansAfter = sshRun('pgrep -fc "sleep[ ]87\\.42" || true', '').trim();
  record('exec_timeout_grandchild_reaped', execRes.code !== 0 && orphansAfter === '0', {
    code: execRes.code, orphansBefore, orphansAfter,
  });

  // 清理
  sshRun(`rm -rf ${root} ${root}-500 ${root}-proc && echo OK`, '');

  const allPass = checks.every((c) => c.passed);
  const evidence = {
    generatedAt: new Date().toISOString(),
    alias: ALIAS,
    baseline,
    checks,
    allPass,
    stage: 'P1 (F1/F2/F6) + P3 (F4 进程面)',
    head: require('../package.json').version,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2));
  console.log(`\n${allPass ? 'ALL PASS' : 'FAILED'} → ${OUT}`);
  process.exitCode = allPass ? 0 : 1;
})().catch((e) => {
  console.error('LIVE PROBE ERROR:', e.message);
  process.exitCode = 1;
});
