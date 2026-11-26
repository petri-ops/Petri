/**
 * harness 第二轮评估（owner msg_9bad43ff203d）机械小项 M3：
 * checkpoint 写失败静默 catch {} → logError 留痕（零语义变更、与第一轮 OB-004 同向）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/loop-orchestrator.js'), 'utf8');

test('HK-01-1：loop-orchestrator 引入 logError（不新增依赖、复用 shared-backend）', () => {
  assert.match(src, /const \{ logError \} = require\(['"]\.\.\/shared-backend\/error-log['"]\)/);
});

test('HK-01-2：checkpoint 写入失败不再静默吞（saveContextCheckpoint 后的 catch 带留痕）', () => {
  const at = src.indexOf('saveContextCheckpoint({');
  assert.ok(at > -1, 'saveContextCheckpoint 调用缺失');
  const block = src.slice(at, at + 600);
  assert.match(block, /catch \(error\)[\s\S]{0,160}logError\(/);
  assert.doesNotMatch(block, /\}\s*catch \{\s*\}/);
});
