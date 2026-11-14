/**
 * BLOCK-449 · m7-longtask-resume-live flow 注册契约测试（M7 §8 第 5 条补腿）。
 *
 * 契约：
 *  1) flow 文件可加载且导出 { id, description, evidenceDir, run }，id 与文件名词干一致；
 *  2) 注册面可见：dev-verify --list 列出该 id；
 *  3) 证据落点收敛在 acceptance/block-449/evidence/dev-verify；
 *  4) 红线负测：flow 源码不得对 PETRI_TEST_ONSCREEN 赋值（无窗实机纪律，禁设 1）。
 *
 * 负测即红绿证据：契约谓词对「被篡改 flow」必须判红（HK-01 门自身防假绿同款）。
 */
import test from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOW_PATH = path.join(ROOT, '.agents/skills/petri-dev-infra/dev-verify/flows/m7-longtask-resume-live.cjs');

function flowPredicate(mod) {
  const issues = [];
  if (!mod || typeof mod !== 'object') issues.push('FLOW_NOT_OBJECT');
  if (mod.id !== 'm7-longtask-resume-live') issues.push('FLOW_ID_MISMATCH');
  if (typeof mod.run !== 'function') issues.push('FLOW_RUN_MISSING');
  if (typeof mod.description !== 'string' || mod.description.length < 8) issues.push('FLOW_DESCRIPTION_MISSING');
  if (!String(mod.evidenceDir || '').includes(path.join('acceptance', 'block-449', 'evidence'))) {
    issues.push('FLOW_EVIDENCE_DIR_OUT_OF_PACKAGE');
  }
  return issues;
}

test('flow 文件可加载且导出契约齐备', () => {
  assert.equal(fs.existsSync(FLOW_PATH), true, 'flow 文件在场');
  const mod = require(FLOW_PATH);
  const issues = flowPredicate(mod);
  assert.deepEqual(issues, [], `flow 契约零 issue：${issues.join(',')}`);
});

test('注册面可见：dev-verify --list 列出 m7-longtask-resume-live', () => {
  const out = execFileSync('node', [path.join(ROOT, '.agents/skills/petri-dev-infra/dev-verify/run.cjs'), '--list'], {
    encoding: 'utf8',
    cwd: ROOT,
    timeout: 30_000,
  });
  assert.match(out, /m7-longtask-resume-live/, '--list 输出含 flow id');
});

test('负测：契约谓词对被篡改 flow 必判红（防假绿）', () => {
  const tampered = { id: 'wrong-id', run: undefined, description: 'x', evidenceDir: '/tmp/elsewhere' };
  const issues = flowPredicate(tampered);
  assert.ok(issues.includes('FLOW_ID_MISMATCH'), 'id 篡改必红');
  assert.ok(issues.includes('FLOW_RUN_MISSING'), 'run 缺失必红');
  assert.ok(issues.includes('FLOW_EVIDENCE_DIR_OUT_OF_PACKAGE'), '证据目录越包必红');
});

test('红线负测：flow 源码不对 PETRI_TEST_ONSCREEN 赋值（无窗实机纪律）', () => {
  const src = fs.readFileSync(FLOW_PATH, 'utf8');
  assert.doesNotMatch(src, /PETRI_TEST_ONSCREEN\s*=\s*['"1]/, '禁设 PETRI_TEST_ONSCREEN=1（只允许读取断言）');
  assert.match(src, /kill9223Instance|TEST_INSTANCE_PORT/, '跑完立即 kill 纪律在源');
});
