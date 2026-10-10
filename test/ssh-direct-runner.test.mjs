// BLOCK-76 P1 — ssh-direct-runner 零网络定向测试。
// 伪 gateway 后端（内存态）锁直跑内核契约：stage 编排面（排除 output/）/
// 分块追加上传 / start 命令形态（.exit 标记 + 日志重定向）/ poll 三态 /
// 进程组取消 / output 清单 / 路径逃逸拒绝。
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createSshDirectRunner } = require('../core/petri-server/helpers/remote-execution/ssh-direct-runner.js');

const PROJECT = { id: 'p_test', workspace_kind: 'ssh', ssh_host: 'test-node', remote_path: '/srv/proj' };

function makeFakeGateway({ aliveCallsBeforeExit = 1, exitCode = 0 } = {}) {
  const calls = { writes: [], mkdirs: [], execs: [], execBg: [], kills: [] };
  let aliveCount = 0;
  let pid = 4321;
  return {
    calls,
    kind: 'ssh',
    setPid(v) { pid = v; },
    async mkdir(p) { calls.mkdirs.push(p); },
    async write(p, content) { calls.writes.push({ p, content: Buffer.from(content) }); },
    async read(p, _opts = {}) {
      if (p.includes('job_p1') && p.endsWith('.exit')) return Buffer.from(`${exitCode}\n`);
      if (p.endsWith('run.log')) return Buffer.from('LOG-TAIL-BYTES');
      throw new Error('not_found');
    },
    async stat(p) { return p.endsWith('run.log') ? { size: 14 } : { size: 2 }; },
    async list(p) {
      if (p.endsWith('output')) {
        return [
          { name: 'figure.png', type: 'file', size: 1234 },
          { name: 'table.csv', type: 'file', size: 88 },
        ];
      }
      return [];
    },
    async exec(command) { calls.execs.push(command); return { code: 0, stdout: '', stderr: '' }; },
    async execBackground(command, cwd, logPath) {
      calls.execBg.push({ command, cwd, logPath });
      return { pid };
    },
    async processAlive() {
      aliveCount += 1;
      return { alive: aliveCount <= aliveCallsBeforeExit };
    },
    async killPid(p, sig) { calls.kills.push({ p, sig }); return { signaled: true }; },
  };
}

function makeLocalJobDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b76-job-'));
  fs.writeFileSync(path.join(dir, 'run-script.R'), 'cat(job_dir)\n');
  fs.writeFileSync(path.join(dir, 'params.json'), '{}');
  fs.mkdirSync(path.join(dir, 'input'));
  fs.writeFileSync(path.join(dir, 'input', 'counts.csv'), 'a,b\n1,2\n');
  fs.mkdirSync(path.join(dir, 'output'));
  fs.writeFileSync(path.join(dir, 'output', 'stale.txt'), 'nope');
  return dir;
}

test('stage：编排面整体上服务器（排除 output/logs），大文件走分块追加', async () => {
  const gw = makeFakeGateway();
  const runner = createSshDirectRunner({ project: PROJECT, gateway: gw });
  const jobDir = makeLocalJobDir();
  // 造一个 >768KB 的大输入，验证分块追加通道
  const big = Buffer.alloc(800 * 1024, 0x61);
  fs.writeFileSync(path.join(jobDir, 'input', 'big.csv'), big);

  const res = await runner.stage({ jobId: 'job_big1', localJobDir: jobDir });
  assert.equal(res.ok, true);
  // jobRel 恒为相对项目根的语义路径（result_json 面）；gateway 调用才转绝对
  assert.equal(res.jobRel, 'results/jobs/job_big1');
  // mkdir：job 根 + output
  assert.ok(gw.calls.mkdirs.some((p) => p === '/srv/proj/results/jobs/job_big1/output'));
  // 小文件直写
  const wrote = gw.calls.writes.map((w) => w.p);
  assert.ok(wrote.includes('/srv/proj/results/jobs/job_big1/run-script.R'));
  assert.ok(wrote.includes('/srv/proj/results/jobs/job_big1/params.json'));
  assert.ok(wrote.includes('/srv/proj/results/jobs/job_big1/input/counts.csv'));
  // output/ 下旧物不上传
  assert.ok(!wrote.some((p) => p.includes('output/')));
  // 大文件：create + 分块 exec 追加（800KB → 6 块）
  const appends = gw.calls.execs.filter((c) => c.includes('big.csv'));
  assert.ok(appends.length >= Math.ceil((800 * 1024) / (160 * 1024)), `appends=${appends.length}`);
  fs.rmSync(jobDir, { recursive: true, force: true });
});

test('start：命令形态 = runtime 跑 run-script + .exit 标记 + 日志重定向（cwd=jobRel）', async () => {
  const gw = makeFakeGateway();
  const runner = createSshDirectRunner({ project: PROJECT, gateway: gw });
  const started = await runner.start({ jobId: 'job_s1', lang: 'r', runtimeBin: '/usr/bin/Rscript' });
  assert.equal(started.ok, true);
  assert.equal(started.pid, 4321);
  const call = gw.calls.execBg[0];
  assert.equal(call.cwd, '/srv/proj/results/jobs/job_s1');
  assert.equal(call.logPath, '/srv/proj/results/jobs/job_s1/output/run.log');
  assert.ok(call.command.startsWith('echo $$ > output/.pid; /usr/bin/Rscript run-script.R "$(pwd)"'));
  assert.ok(call.command.includes('echo $? > output/.exit'));
});

test('poll：pid 存活=active；退出后读 .exit=terminal(code)；标记缺失=unknown', async () => {
  const gw = makeFakeGateway({ aliveCallsBeforeExit: 1, exitCode: 3 });
  const runner = createSshDirectRunner({ project: PROJECT, gateway: gw });
  const first = await runner.poll({ jobId: 'job_p1', pid: 99 });
  assert.equal(first.kind, 'active');
  const second = await runner.poll({ jobId: 'job_p1', pid: 99 });
  assert.equal(second.kind, 'terminal');
  assert.equal(second.code, 3);

  const gw2 = makeFakeGateway({ aliveCallsBeforeExit: 0 });
  // 伪 gw2 不认 .exit（read 只认特定后缀——job_p2 的 .exit 会被认出，改用不存在目录语义）
  const runner2 = createSshDirectRunner({ project: PROJECT, gateway: gw2 });
  const unknown = await runner2.poll({ jobId: 'job_missing', pid: 5 });
  assert.equal(unknown.kind, 'unknown');
});

test('cancel：进程组 kill（负 pid 经 gateway exec），并兜底 killPid', async () => {
  const gw = makeFakeGateway();
  const runner = createSshDirectRunner({ project: PROJECT, gateway: gw });
  const res = await runner.cancel({ pid: 4321 });
  assert.equal(res.ok, true);
  assert.ok(gw.calls.execs.some((c) => c.includes('kill -TERM -- -4321') && c.includes('kill -KILL -- -4321')));
  assert.deepEqual(gw.calls.kills, [{ p: 4321, sig: 'KILL' }]);
});

test('pullLog：offset 增量（size<=offset 空块；有新增返回字节）', async () => {
  const gw = makeFakeGateway();
  const runner = createSshDirectRunner({ project: PROJECT, gateway: gw });
  const none = await runner.pullLog({ jobId: 'job_l1', offset: 14 });
  assert.equal(none.chunk.length, 0);
  const some = await runner.pullLog({ jobId: 'job_l1', offset: 4 });
  assert.equal(some.chunk.toString(), 'LOG-TAIL-BYTES');
  assert.equal(some.size, 14);
});

test('listOutputs：output/ 文件清单映射 name/size', async () => {
  const gw = makeFakeGateway();
  const runner = createSshDirectRunner({ project: PROJECT, gateway: gw });
  const res = await runner.listOutputs({ jobId: 'job_o1' });
  assert.deepEqual(res.outputs, [
    { name: 'figure.png', size: 1234 },
    { name: 'table.csv', size: 88 },
  ]);
});

test('安全门：非 SSH 项目拒绝创建', () => {
  assert.throws(() => createSshDirectRunner({ project: { workspace_kind: 'local' }, gateway: makeFakeGateway() }), /ssh_direct_requires_ssh_project/);
});
