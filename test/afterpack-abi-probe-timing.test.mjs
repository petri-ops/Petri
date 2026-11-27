/**
 * item 66 / HK-01：afterPack ABI 探针时机修复——探针在原生模块产物/探针运行时
 * 就绪前执行，导致 better-sqlite3 darwin-arm64-149 在打包时被误判（实测该产物
 * 两个候选探针均可加载：acceptance/g1-release-pipeline/UNSIGNED-BUILD-EVIDENCE.md §2）。
 *
 * 修法：①候选产物「存在且 size/mtime 稳定」才探（等 build/复制完成）；
 * ②探针运行时不可用/产物仍在写时幂等重试（有界预算）+ 探针二进制多候选回退；
 * ③fail-closed 语义保留（预算耗尽仍红、豁免口 PETRI_PACK_PROBE_FALLBACK=1 不变）。
 *
 * 红阶段：本文件针对修复后的 API（resolveNativeSource 可注入探针/预算）编写，
 * 修复前导出不存在的 API 或行为不满足，断言即红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const afterPackModule = createRequire(import.meta.url)(path.join(ROOT, 'build/afterPack.js'));
const { resolveNativeSource } = afterPackModule;

function makeContext() {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'item66-probe-'));
  const prebuiltDir = path.join(projectDir, 'node_modules', 'better-sqlite3', 'bin', 'darwin-arm64-149');
  fs.mkdirSync(prebuiltDir, { recursive: true });
  fs.writeFileSync(path.join(prebuiltDir, 'better-sqlite3.node'), 'pretend-electron-abi-149');
  return {
    packager: { projectDir, appInfo: { productFilename: 'Petri' } },
    appOutDir: path.join(projectDir, 'dist-out'),
    _tmp: projectDir,
  };
}

// 注入用假探针：(probeBin, nativeBinary) => true/false/null
function fakeProbe(script) {
  let calls = 0;
  const fn = (probeBin, nativeBinary) => script({ calls: calls++, probeBin, nativeBinary });
  fn.callCount = () => calls;
  return fn;
}

const DEPS_FAST = { probeBins: ['/fake/probe'], settleMs: 10, readyTimeoutMs: 5000 };

test('HK-01-1：探针运行时晚就绪 → 幂等重试后成功（复现两次打包误判）', async () => {
  const ctx = makeContext();
  const probe = fakeProbe(({ calls }) => (calls < 2 ? null : true)); // 前两次=探针基础设施不可用
  const source = await resolveNativeSource(ctx, { ...DEPS_FAST, probe });
  assert.equal(source, path.join(ctx._tmp, 'node_modules', 'better-sqlite3', 'bin', 'darwin-arm64-149', 'better-sqlite3.node'));
  assert.ok(probe.callCount() >= 3, `应重试探针而非首试即红（实际调用 ${probe.callCount()} 次）`);
  fs.rmSync(ctx._tmp, { recursive: true, force: true });
});

test('HK-01-2：候选产物晚就绪 → 等复制完成再探，不再即时判未找到', async () => {
  const ctx = makeContext();
  const lateFile = path.join(ctx._tmp, 'node_modules', 'better-sqlite3', 'bin', 'darwin-x64-149', 'better-sqlite3.node');
  fs.rmSync(path.join(ctx._tmp, 'node_modules', 'better-sqlite3', 'bin', 'darwin-arm64-149'), { recursive: true, force: true });
  setTimeout(() => {
    fs.mkdirSync(path.dirname(lateFile), { recursive: true });
    fs.writeFileSync(lateFile, 'late-arriving-copy');
  }, 150);
  const probe = fakeProbe(({ nativeBinary }) => (nativeBinary === lateFile ? true : false));
  const source = await resolveNativeSource(ctx, { ...DEPS_FAST, probe, readyTimeoutMs: 8000 });
  assert.equal(source, lateFile);
  fs.rmSync(ctx._tmp, { recursive: true, force: true });
});

test('HK-01-3：首个探针二进制不可用 → 回退到下一探针二进制', async () => {
  const ctx = makeContext();
  const probe = fakeProbe(({ probeBin }) => (probeBin === '/fake/helper' ? null : true));
  const source = await resolveNativeSource(ctx, { ...DEPS_FAST, probe, probeBins: ['/fake/helper', '/fake/electron-dist'] });
  assert.ok(source.endsWith('better-sqlite3.node'));
  fs.rmSync(ctx._tmp, { recursive: true, force: true });
});

test('HK-01-4：fail-closed 保留——探针全程不可用且无豁免 → 构建红', async () => {
  const ctx = makeContext();
  const probe = fakeProbe(() => null);
  await assert.rejects(
    () => resolveNativeSource(ctx, { ...DEPS_FAST, probe, readyTimeoutMs: 300, settleMs: 50 }),
    /fail-closed|探针不可用|PETRI_PACK_PROBE_FALLBACK/,
  );
  fs.rmSync(ctx._tmp, { recursive: true, force: true });
});

test('HK-01-5：真 ABI 不匹配（产物稳定）→ 仍 fail-closed 红，不长等', async () => {
  const ctx = makeContext();
  const probe = fakeProbe(() => false);
  const t0 = Date.now();
  await assert.rejects(
    () => resolveNativeSource(ctx, { ...DEPS_FAST, probe, readyTimeoutMs: 8000 }),
    /未找到匹配|ABI/,
  );
  assert.ok(Date.now() - t0 < 7000, `稳定产物的确定性 mismatch 不应耗满预算（耗时 ${Date.now() - t0}ms）`);
  fs.rmSync(ctx._tmp, { recursive: true, force: true });
});

test('HK-01-6：豁免口保留——PETRI_PACK_PROBE_FALLBACK=1 时探针不可用采用首候选', async () => {
  const ctx = makeContext();
  const probe = fakeProbe(() => null);
  process.env.PETRI_PACK_PROBE_FALLBACK = '1';
  try {
    const source = await resolveNativeSource(ctx, { ...DEPS_FAST, probe, readyTimeoutMs: 300, settleMs: 50 });
    assert.equal(source, path.join(ctx._tmp, 'node_modules', 'better-sqlite3', 'bin', 'darwin-arm64-149', 'better-sqlite3.node'));
  } finally {
    delete process.env.PETRI_PACK_PROBE_FALLBACK;
    fs.rmSync(ctx._tmp, { recursive: true, force: true });
  }
});
