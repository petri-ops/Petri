import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * CK-11 收官保留面棘轮（quality:knip:check）的 test:changed 挂点：
 * 真实门禁=scripts/knip-ratchet.mjs 检查模式（exports/types/files 逐键基线，
 * 新增即红）。本文件让 impact-map 把 knip 面（knip.json/棘轮脚本/基线）的变更
 * 路由到真实门禁本身，而不是一份平行断言。
 */
test('knip 保留面棘轮：当前工作区无新增死代码（基线即真相）', () => {
  const baselinePath = path.join(root, 'test/knip-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  assert.deepEqual(baseline.categories, ['exports', 'types', 'files'], '冻结类别固定为死代码三类');
  assert.ok(Array.isArray(baseline.keys) && baseline.keys.length > 0, '基线键非空');
  assert.deepEqual([...baseline.keys].sort(), baseline.keys, '基线键必须有序（--update 产物形态）');

  const result = spawnSync(process.execPath, [path.join(root, 'scripts/knip-ratchet.mjs')], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    `棘轮判红（新增死代码应删除或定性后 --update）:\n${result.stdout}\n${result.stderr}`,
  );
  assert.match(result.stdout, /PASS/);
});
