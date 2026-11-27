#!/usr/bin/env node
'use strict';

/**
 * scripts/verify-clean.mjs — item 86「verify:clean 一条命令」。
 *
 * 把「CI 的严格性」搬到本地：临时目录全新 checkout + npm ci + 全套门禁，
 * 替代依赖本机脏状态（node_modules 缓存 / 未提交 WIP / 增量缓存）的 closeout。
 *
 * 流程：
 *   1. 预检：当前工作树必须干净（git status --porcelain 为空），脏即拒绝（exit 2）
 *      ——不把未提交/未跟踪状态带进验收，也不静默代为 stash（脏状态是用户资产）。
 *   2. 临时目录 git clone（本地克隆 = HEAD 全新 checkout，零本机 node_modules 缓存）。
 *   3. npm ci（根 + frontend；--skip-install 跳过，供自测 fixture 用）。
 *   4. 逐门执行（默认 = desktop-ci 工作流等价集；--gates 可收窄为逗号分隔的 npm script 名）。
 *      门失败即停，打印失败门与输出尾部，exit 1。
 *   5. 清理临时目录（--keep 保留排查）。
 *
 * 退出码：0 全绿 / 1 门失败 / 2 预检拒绝（脏树）/ 3 环境错误（克隆/安装失败）。
 *
 * 自测：test/item86-verify-clean.test.mjs（干净 fixture 跑通 + 脏 fixture 跑红 +
 * 门失败如实红 + 默认清单防漂移钉）。自测经 --self-test 走精简输出。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// CI 等价门清单（来源 .github/workflows/ci.yml；改动 CI 时同步此处——
// HK-86-9 防漂移钉钉住了其中的关键成员）。
const CI_STATIC_GATES = [
  'docs:check',
  'ui:audit:check',
  'quality:secret',
  'quality:arch',
  'quality:lint',
  'quality:types',
  'gate:code-size',
  'gate:css-modules',
  'gate:arch-cycles',
  'quality:knip:check',
  'gate:tracked-consistency',
];
const CI_PLATFORM_TEST_FILES = [
  'test/platform-compat.test.mjs',
  'test/migration-runner.test.mjs',
  'test/artifact-truth.test.mjs',
  'test/harness-file-index.test.mjs',
  'test/mcp-tool-registry.test.mjs',
];
const CI_HARNESS_TEST_FILES = [
  'test/agent-tool-registry.test.mjs',
  'test/agent-tool-policy.test.mjs',
  'test/harness-workspace-tools.test.mjs',
  'test/agent-tool-result.test.mjs',
  'test/agent-provider-boundary.test.mjs',
  'test/agent-approval.test.mjs',
  'test/project-memory-isolation.test.mjs',
  'test/diagnostic-redaction.test.mjs',
];

function parseArgs(argv) {
  const args = { root: REPO_ROOT, skipInstall: false, gates: null, keep: false, selfTest: false }; // selfTest 供测试驱动时辨识（当前仅精简输出占位）
  for (const [index, arg] of argv.entries()) {
    const next = argv.at(index + 1);
    if (arg === '--root') Object.defineProperty(args, 'root', { value: path.resolve(next ?? ''), writable: true, enumerable: true, configurable: true });
    else if (arg === '--skip-install') args.skipInstall = true;
    else if (arg === '--gates') args.gates = next;
    else if (arg === '--keep') args.keep = true;
    else if (arg === '--self-test') args.selfTest = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg.startsWith('--')) {
      console.error(`[verify-clean] 未知参数：${arg}（--help 查看用法）`);
      process.exit(3);
    }
  }
  return args;
}

/** 预检：工作树必须干净。返回 null（干净）或 { files, message }。 */
export function checkDirty(root) {
  const status = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' });
  if (status.error || status.status !== 0) {
    return { files: [], message: `git status 失败：${status.stderr || status.error}` };
  }
  const files = status.stdout.split('\n').map((line) => line.trim()).filter(Boolean);
  if (files.length === 0) return null;
  return {
    files,
    message: [
      '工作树不干净——verify:clean 拒绝在脏状态上验收（不代为 stash，脏状态是用户资产）：',
      ...files.slice(0, 20).map((file) => `  ${file}`),
      files.length > 20 ? `  …共 ${files.length} 项` : '',
      '请先提交或自行 stash 后重跑。',
    ].filter(Boolean).join('\n'),
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    cwd: options.cwd || REPO_ROOT,
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeoutMs || 45 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    code: result.status === null ? 1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error && result.error.message,
  };
}

/** 门清单展开：预设名（ci/static/platform/harness/frontend）→ 步骤数组；其他值视为 npm script 名。 */
export function resolveGateSteps(gatesArg) {
  const names = (gatesArg ? gatesArg.split(',') : ['ci']).map((name) => name.trim()).filter(Boolean);
  const steps = [];
  const pushPreset = (name) => {
    if (name === 'ci') {
      pushPreset('static');
      pushPreset('platform');
      pushPreset('harness');
      pushPreset('frontend');
      return;
    }
    if (name === 'static') {
      for (const gate of CI_STATIC_GATES) steps.push({ name: gate, kind: 'npm' });
      return;
    }
    if (name === 'platform') {
      steps.push({ name: 'platform regressions', kind: 'node-test', files: CI_PLATFORM_TEST_FILES });
      return;
    }
    if (name === 'harness') {
      steps.push({ name: 'harness:check', kind: 'npm' });
      steps.push({ name: 'harness:phase6', kind: 'npm' });
      steps.push({ name: 'harness tool bundle', kind: 'node-test', files: CI_HARNESS_TEST_FILES });
      return;
    }
    if (name === 'frontend') {
      // script 与显示 name 分离：'check' 是 frontend 包的 script 名（首验曾把显示名当 script 传给 npm）
      steps.push({ name: 'frontend check (tsc)', script: 'check', kind: 'npm', prefix: 'frontend' });
      steps.push({ name: 'build:spa', kind: 'npm' });
      return;
    }
    steps.push({ name, kind: 'npm' });
  };
  for (const name of names) pushPreset(name);
  return steps;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`用法：node scripts/verify-clean.mjs [选项]

把 CI 的严格性搬到本地：临时目录全新 checkout + npm ci + 全套门禁。

选项：
  --root <dir>        目标仓根（默认本仓；自测用）
  --skip-install      跳过 npm ci（自测 fixture 用；对本仓勿用）
  --gates <列表>      逗号分隔：预设（ci/static/platform/harness/frontend）或 npm script 名
                      （默认 ci = desktop-ci 工作流等价集）
  --keep              保留临时 checkout 目录（排查用）
  --self-test         精简输出（供 test/item86-verify-clean.test.mjs 驱动）
退出码：0 全绿 / 1 门失败 / 2 脏树拒绝 / 3 环境错误`);
    process.exit(0);
  }

  const startedAt = Date.now();
  const log = (...parts) => console.log('[verify-clean]', ...parts);

  // 1. 预检
  const dirty = checkDirty(args.root);
  if (dirty) {
    console.error(`[verify-clean] FAIL（预检拒绝，exit 2）\n${dirty.message}`);
    process.exit(2);
  }
  log('预检通过：工作树干净');

  // 2. 临时全新 checkout
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-verify-clean-'));
  const checkoutDir = path.join(tmpDir, 'checkout');
  let failed = null;
  try {
    log('克隆 HEAD 到临时目录…');
    const clone = run('git', ['clone', '--quiet', '--local', '--no-hardlinks', args.root, checkoutDir]);
    if (clone.code !== 0) {
      console.error(`[verify-clean] FAIL（克隆失败，exit 3）\n${clone.stderr || clone.error}`);
      process.exit(3);
    }

    // 3. 安装
    if (!args.skipInstall) {
      log('npm ci（根）…');
      const install = run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: checkoutDir });
      if (install.code !== 0) {
        console.error(`[verify-clean] FAIL（npm ci 根失败，exit 3）\n${(install.stdout + install.stderr).slice(-4000)}`);
        process.exit(3);
      }
      log('npm ci（frontend）…');
      const installFrontend = run('npm', ['ci', '--no-audit', '--no-fund'], { cwd: path.join(checkoutDir, 'frontend') });
      if (installFrontend.code !== 0) {
        console.error(`[verify-clean] FAIL（npm ci frontend 失败，exit 3）\n${(installFrontend.stdout + installFrontend.stderr).slice(-4000)}`);
        process.exit(3);
      }
    }

    // 4. 逐门执行
    const steps = resolveGateSteps(args.gates);
    for (const step of steps) {
      const label = step.kind === 'node-test'
        ? `${step.name}（node --test ${step.files.length} 文件）`
        : (step.prefix ? `${step.prefix} run ${step.name}` : step.name);
      log(`▶ ${label}`);
      let result;
      if (step.kind === 'node-test') {
        result = run('node', ['--test', ...step.files], { cwd: checkoutDir });
      } else {
        const scriptName = step.script || step.name;
        const args2 = ['run', scriptName];
        if (step.prefix) args2.splice(1, 0, '--prefix', step.prefix);
        result = run('npm', args2, { cwd: checkoutDir });
      }
      if (result.code !== 0) {
        failed = { step: label, output: (result.stdout + '\n' + result.stderr).trimEnd() };
        break;
      }
      log(`✔ ${label}`);
    }
  } finally {
    if (failed) {
      console.error(`[verify-clean] FAIL：门「${failed.step}」失败（exit 1）；输出尾部：`);
      console.error(failed.output.slice(-4000));
    }
    if (args.keep) {
      log(`--keep：临时目录保留在 ${tmpDir}`);
    } else {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  if (failed) process.exit(1);

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  log(`PASS：全新 checkout 上 ${resolveGateSteps(args.gates).length} 步全绿（${seconds}s，本机零脏状态依赖）`);
  process.exit(0);
}

// 自测驱动时只加载导出、不执行 main（测试直接调 checkDirty/resolveGateSteps 与 spawn 全流程）。
const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
