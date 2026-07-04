// M2-2 错误归因测试
// 运行：cd desktop-app && npx tsx --test test/errorClassifier.test.mjs
import assert from 'node:assert/strict';
import { classifyError } from '../frontend/src/components/backend/errorClassifier.ts';

// === 包缺失 ===
{
  const r = classifyError("Error: could not find package 'DESeq2'");
  assert.strictEqual(r.category, 'package');
  assert.ok(r.humanReason);
  assert.strictEqual(r.retryable, false);
  console.log('✓ 包缺失通过:', r.humanReason);
}

{
  const r = classifyError("there is no package called 'SingleR'");
  assert.strictEqual(r.category, 'package');
  console.log('✓ 包缺失(no package called)通过');
}

// === 内存不足 ===
{
  const r = classifyError('Error: cannot allocate vector of size 4.0 Gb');
  assert.strictEqual(r.category, 'memory');
  assert.ok(r.humanReason.includes('内存'));
  assert.strictEqual(r.retryable, false);
  console.log('✓ 内存不足通过:', r.humanReason);
}

{
  const r = classifyError('Reached total allocation of 8000Mb: see help(memory.size)');
  assert.strictEqual(r.category, 'memory');
  console.log('✓ 内存分配上限通过');
}

// === 后端不通 ===
{
  const r = classifyError('fetch failed: ECONNREFUSED 127.0.0.1:3001');
  assert.strictEqual(r.category, 'backend');
  assert.strictEqual(r.retryable, true);
  console.log('✓ 后端不通通过:', r.humanReason);
}

{
  const r = classifyError('Error: connect ECONNREFUSED');
  assert.strictEqual(r.category, 'backend');
  console.log('✓ ECONNREFUSED 通过');
}

// === 数据格式问题 ===
{
  const r = classifyError("Error: unexpected symbol in 'read.csv(file)'");
  assert.strictEqual(r.category, 'data');
  assert.strictEqual(r.retryable, false);
  console.log('✓ 数据格式通过:', r.humanReason);
}

{
  const r = classifyError('Error in readRDS: unknown input format');
  assert.strictEqual(r.category, 'data');
  console.log('✓ 数据格式(readRDS)通过');
}

// === 未知错误 ===
{
  const r = classifyError('some random error message');
  assert.strictEqual(r.category, 'unknown');
  assert.ok(r.humanReason);
  assert.strictEqual(r.retryable, false);
  console.log('✓ 未知错误通过:', r.humanReason);
}

// === 空输入 ===
{
  const r = classifyError('');
  assert.strictEqual(r.category, 'unknown');
  console.log('✓ 空输入通过');
}

{
  const r = classifyError(null);
  assert.strictEqual(r.category, 'unknown');
  console.log('✓ null 输入通过');
}

console.log('\n所有 errorClassifier 测试通过');
