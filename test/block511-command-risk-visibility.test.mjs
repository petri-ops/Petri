/**
 * BLOCK-511 S3.3 HK-01 — 命令风险可见性（命中处置不变=默认放行+可见）。
 * ①风险正则加 m 标志，锚点扩到换行与命令替换；②补 find … -delete 与 xargs … rm；
 * ③动态维度逐命令段取首 token（换行/;/&&/||/| 分段，剥 sudo 与前置 env 赋值）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve('.');
const { commandVerdict } = require(path.join(root, 'core/petri-server/agent-tools/workspace-tools/internals.js'));
const policy = require(path.join(root, 'core/petri-server/agent-tools/agent-tool-policy.js'));

const FULL = { accessMode: 'full' };

test('①换行 / $() 命令替换内的 sudo/rm/git push 也出 riskWarnings', () => {
  const cases = [
    'echo start\nrm -rf build/',          // 换行后 rm
    'echo $(sudo whoami) done',           // $() 内 sudo
    'x=1; git push origin main',          // ; 后 git push
    'echo ok && rm -f tmp.log',           // && 后 rm
  ];
  for (const cmd of cases) {
    const v = commandVerdict(cmd, { env: {} });
    assert.ok(Array.isArray(v.riskWarnings) && v.riskWarnings.length > 0, `${cmd} 应出风险提示`);
    assert.equal(v.ok, true, '命中后处置不变：默认放行');
  }
});

test('②find … -delete 与 xargs … rm 出 riskWarnings', () => {
  for (const cmd of ['find . -name "*.tmp" -delete', 'find build -type f -delete', 'ls | xargs rm -f', 'find . -print0 | xargs -0 rm -rf']) {
    const v = commandVerdict(cmd, { env: {} });
    assert.ok(Array.isArray(v.riskWarnings) && v.riskWarnings.length > 0, `${cmd} 应出风险提示`);
    assert.equal(v.ok, true);
  }
});

test('③动态维度逐命令段取首 token：换行/分号/管道后 sudo+破坏命令命中', () => {
  const cases = [
    'echo ok\nformat D:',
    'echo ok; sudo mkfs.ext4 /dev/sdb',
    'echo ok && FOO=1 dd if=/dev/zero of=/dev/sda',
    'echo ok | shutdown /s',
  ];
  for (const cmd of cases) {
    const g = policy.evaluateDynamicGuards('workspace_exec', { command: cmd }, FULL);
    assert.equal(g.flagged, true, `${cmd} 应命中动态维度`);
    assert.match(g.guardKey, /^cmd:(format|mkfs|dd|shutdown)/);
  }
});

test('③常规命令逐段判定仍不误报（rm/npm/git 不入动态维度）', () => {
  for (const cmd of ['echo ok\nrm -rf build/', 'npm install && git push origin main', 'echo ok; node -v']) {
    const g = policy.evaluateDynamicGuards('workspace_exec', { command: cmd }, FULL);
    assert.equal(g.flagged, false, `${cmd} 不应命中动态维度`);
  }
});
