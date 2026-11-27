/**
 * item 86 HK-01 — verify:clean 自测（干净目录跑通 + 脏目录跑红 + 门失败如实红）。
 *
 * 不真跑全套门禁（那是 verify:clean 对本仓的用途，耗时分钟级）；自测用最小 fixture
 * git 仓 + 假门（node -e exit 0/1）验证机制本身：预检拒绝脏树、克隆干净 HEAD、
 * 门逐个执行且失败即红、临时目录用后清理。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'verify-clean.mjs');

function git(dir, ...args) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
}

/** 建一个最小 fixture 仓：package.json 带假门脚本，全部提交（干净树）。 */
function makeFixture(name, { gateScript }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `verify-clean-fixture-${name}-`));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
    name: `fixture-${name}`,
    version: '0.0.0',
    private: true,
    scripts: { 'gate-ok': 'node -e "process.exit(0)"', 'gate-fail': 'node -e "process.exit(3)"' },
  }, null, 2));
  void gateScript;
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'fixture@test.local');
  git(dir, 'config', 'user.name', 'fixture');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'fixture initial');
  return dir;
}

function runVerifyClean(args) {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', timeout: 120_000 });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status ?? 1, stdout: String(error.stdout || '') + String(error.stderr || '') };
  }
}

test('HK-86-6：干净 fixture 目录跑通（克隆→假门执行→临时目录清理）', () => {
  const fixture = makeFixture('clean', {});
  const result = runVerifyClean([
    '--root', fixture,
    '--skip-install',
    '--gates', 'gate-ok',
    '--self-test',
  ]);
  assert.equal(result.code, 0, `干净目录应 PASS：\n${result.stdout}`);
  assert.match(result.stdout, /PASS/);
  // 临时目录已清理：tmp 下不残留本次运行目录
  const leftovers = fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('petri-verify-clean-'));
  assert.deepEqual(leftovers, [], '临时 checkout 目录应清理');
});

test('HK-86-7（跑红）：脏 fixture 目录预检拒绝，不出临时目录', () => {
  const fixture = makeFixture('dirty', {});
  fs.writeFileSync(path.join(fixture, 'untracked.txt'), 'dirty');
  const result = runVerifyClean([
    '--root', fixture,
    '--skip-install',
    '--gates', 'gate-ok',
    '--self-test',
  ]);
  assert.equal(result.code, 2, `脏目录必须跑红：\n${result.stdout}`);
  assert.match(result.stdout, /untracked\.txt/);
  assert.match(result.stdout, /脏|dirty/i);
  // 不克隆：tmp 下无运行目录
  const leftovers = fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('petri-verify-clean-'));
  assert.deepEqual(leftovers, [], '脏目录预检失败不得创建临时目录');
});

test('HK-86-8（跑红）：干净目录但门失败 → 如实红并报出门名', () => {
  const fixture = makeFixture('gatefail', {});
  const result = runVerifyClean([
    '--root', fixture,
    '--skip-install',
    '--gates', 'gate-ok,gate-fail',
    '--self-test',
  ]);
  assert.equal(result.code, 1, '门失败必须红');
  assert.match(result.stdout, /FAIL/);
  assert.match(result.stdout, /gate-fail/);
});

test('HK-86-9：默认门清单是 CI 等价集（防漂移钉）', () => {
  // 直接读脚本源里的预设定义（机制自检：默认集必须覆盖 11 静态门 + platform + harness + 前端）
  const source = fs.readFileSync(SCRIPT, 'utf8');
  for (const gate of [
    'docs:check', 'ui:audit:check', 'quality:secret', 'quality:arch', 'quality:lint',
    'quality:types', 'gate:code-size', 'gate:css-modules', 'gate:arch-cycles',
    'quality:knip:check', 'gate:tracked-consistency',
    'platform-compat.test.mjs', 'harness:check', 'harness:phase6', 'build:spa',
  ]) {
    assert.ok(source.includes(gate), `默认门清单应包含 ${gate}`);
  }
});
