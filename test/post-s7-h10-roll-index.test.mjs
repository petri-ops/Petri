/**
 * B-29 docs:roll-index 只读对账门。
 * 它("--check")是预览而非迁移，故本门只钉「报告形状 + 无异常」，不冒充索引已滚动完成。
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function checkOutput() {
  return execFileSync(process.execPath, ['scripts/docs-roll-index.mjs', '--check'], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000,
  });
}

test('--check 只读预览：报告在册且明确「未写入」', () => {
  const out = checkOutput();
  assert.ok(/\[check\]/.test(out));
  assert.ok(/预览未写入/.test(out), '必须如实标注未写入，不能冒充已迁移');
  assert.ok(/索引注册|当月保留/.test(out));
});

test('不对源文件做写入（跑两次输出一致，幂等）', () => {
  const a = checkOutput().replace(/\d+ms/g, 'Nms');
  const b = checkOutput().replace(/\d+ms/g, 'Nms');
  assert.equal(a, b);
});

test('负测：脚本缺 --check 时不得被本门当作预览（防误用写模式）', async () => {
  const src = (await import('node:fs')).readFileSync(path.join(ROOT, 'scripts/docs-roll-index.mjs'), 'utf8');
  assert.ok(src.includes("args.includes('--check')"));
});
