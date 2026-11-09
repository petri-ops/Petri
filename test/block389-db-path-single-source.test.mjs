/**
 * POST-S7 H4/B-19 —— DB 路径解析单源契约。
 *
 * 此前 `src/database/branch-db.js:getDatabasePath()` 自行 `path.join(PETRI_LOCAL_DATA_DIR,'petri.db')`，
 * 完全不认 `PETRI_DB_PATH`；而 core 侧 `resolveDbPath` 认。同一次运行里两个消费者可能指向不同
 * 文件——这类「两套路径解析」不会立刻报错，只会在排查数据不一致时把人拖死。
 *
 * 现在 branch-db 委托单源。本测试钉三态：显式 PETRI_DB_PATH 优先 / 仅 dataDir 时回落拼接 /
 * 两者皆无时 fail-fast（保持原语义，不静默落到别的目录）。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const { getDatabasePath } = require(path.join(ROOT, 'src/database/branch-db.js'));

function withEnv(vars, fn) {
  const backup = {};
  for (const key of Object.keys(vars)) {
    backup[key] = process.env[key];
    if (vars[key] === undefined) delete process.env[key];
    else process.env[key] = vars[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(backup)) {
      if (backup[key] === undefined) delete process.env[key];
      else process.env[key] = backup[key];
    }
  }
}

test('显式 PETRI_DB_PATH 优先（旧实现不认）', () => {
  const explicit = path.join(ROOT, '.tmp-test', 'explicit.db');
  withEnv({ PETRI_DB_PATH: explicit, PETRI_LOCAL_DATA_DIR: path.join(ROOT, '.tmp-test', 'data') }, () => {
    assert.equal(getDatabasePath(), explicit);
  });
});

test('未设 PETRI_DB_PATH 时回落 PETRI_LOCAL_DATA_DIR/petri.db', () => {
  const dataDir = path.join(ROOT, '.tmp-test', 'data');
  withEnv({ PETRI_DB_PATH: undefined, PETRI_LOCAL_DATA_DIR: dataDir }, () => {
    assert.equal(getDatabasePath(), path.join(dataDir, 'petri.db'));
  });
});

test('两者皆无时 fail-fast（不静默落盘到别处）', () => {
  withEnv({ PETRI_DB_PATH: undefined, PETRI_LOCAL_DATA_DIR: undefined }, () => {
    assert.throws(() => getDatabasePath(), /PETRI_LOCAL_DATA_DIR environment variable is not set/);
  });
});

test('与 core 侧 resolveDbPath 同源（同 env 同结果）', () => {
  const { resolveDbPath } = require(path.join(ROOT, 'core/shared-backend/db-connection-policy.js'));
  const explicit = path.join(ROOT, '.tmp-test', 'same.db');
  withEnv({ PETRI_DB_PATH: explicit }, () => {
    assert.equal(getDatabasePath(), resolveDbPath(process.env));
  });
});
