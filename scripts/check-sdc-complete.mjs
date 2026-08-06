#!/usr/bin/env node
/**
 * SDC-1 完整 + SDC-2 Semantic Binder 收口门禁脚本
 *
 * 跑两项测试：
 *   1. test/sdc1-complete.test.mjs（Node 原生，验证 data-profiler 全能力）
 *   2. frontend/src/lib/data-profile.test.ts（Vitest，验证 deriveDataReadiness 三轨）
 *
 * 输出：
 *   - acceptance/g0-scientific-data-contract/sdc1-complete.json
 *   - acceptance/g0-scientific-data-contract/sdc2-semantic-binder.json
 *
 * 退出码：任何测试失败则 exit 1
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const ROOT = resolve(process.cwd());
const ACCEPTANCE_DIR = resolve(ROOT, 'acceptance', 'g0-scientific-data-contract');
const SDC1_EVIDENCE = resolve(ACCEPTANCE_DIR, 'sdc1-complete.json');
const SDC2_EVIDENCE = resolve(ACCEPTANCE_DIR, 'sdc2-semantic-binder.json');

async function runNodeTest(file) {
  const start = Date.now();
  try {
    const { stdout, stderr } = await exec('node', ['--test', '--test-reporter=tap', file], {
      cwd: ROOT,
      timeout: 60_000,
    });
    const { tests, pass, fail } = parseTapSummary(stdout + stderr);
    return {
      ok: fail === 0 && tests > 0,
      tests,
      pass,
      fail,
      durationMs: Date.now() - start,
      output: stdout.slice(-2000),
    };
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    const { tests, pass, fail } = parseTapSummary(out);
    return {
      ok: false,
      tests,
      pass,
      fail,
      durationMs: Date.now() - start,
      output: out.slice(-3000),
      error: err.message,
    };
  }
}

async function runVitestTest(file) {
  const start = Date.now();
  try {
    const { stdout, stderr } = await exec(
      'npm',
      ['run', 'test:files', '--', file],
      { cwd: resolve(ROOT, 'frontend'), timeout: 120_000 },
    );
    const out = stdout + stderr;
    return {
      ok: !/FAIL\s|failed|AssertionError/.test(out) && /passed/.test(out),
      durationMs: Date.now() - start,
      output: out.slice(-2000),
    };
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    return {
      ok: false,
      durationMs: Date.now() - start,
      output: out.slice(-3000),
      error: err.message,
    };
  }
}

function parseTapSummary(tap) {
  const testsMatch = tap.match(/# tests (\d+)/);
  const passMatch = tap.match(/# pass (\d+)/);
  const failMatch = tap.match(/# fail (\d+)/);
  return {
    tests: testsMatch ? parseInt(testsMatch[1], 10) : 0,
    pass: passMatch ? parseInt(passMatch[1], 10) : 0,
    fail: failMatch ? parseInt(failMatch[1], 10) : 0,
  };
}

async function main() {
  if (!existsSync(ACCEPTANCE_DIR)) {
    await mkdir(ACCEPTANCE_DIR, { recursive: true });
  }

  const startedAt = new Date().toISOString();
  const sdc1 = await runNodeTest('test/sdc1-complete.test.mjs');
  const sdc2 = await runVitestTest('src/lib/data-profile.test.ts');
  const finishedAt = new Date().toISOString();

  const sdc1Evidence = {
    workPackage: 'G0-SDC-1',
    stage: 'complete',
    startedAt,
    finishedAt,
    mode: 'source-bound',
    fixtureDir: 'test/fixtures/sdc/',
    testFile: 'test/sdc1-complete.test.mjs',
    ...sdc1,
  };

  const sdc2Evidence = {
    workPackage: 'G0-SDC-2',
    stage: 'semantic-binder',
    startedAt,
    finishedAt,
    mode: 'source-bound',
    testFile: 'frontend/src/lib/data-profile.test.ts',
    ...sdc2,
  };

  await writeFile(SDC1_EVIDENCE, JSON.stringify(sdc1Evidence, null, 2) + '\n', 'utf8');
  await writeFile(SDC2_EVIDENCE, JSON.stringify(sdc2Evidence, null, 2) + '\n', 'utf8');

  console.log(JSON.stringify({ sdc1, sdc2 }, null, 2));

  if (!sdc1.ok || !sdc2.ok) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
