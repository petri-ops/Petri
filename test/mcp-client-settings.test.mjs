/**
 * BLOCK-156 P2 — mcp-settings 持久化测试。
 * 钉住：往返读写/单条 upsert·remove/非法条目拒绝（fail-closed 写入·fail-open 读取）/
 * 损坏文件降级空清单。BIOF3_LOCAL_DATA_DIR 指向临时目录隔离本机真实清单。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b156-mcp-settings-'));
process.env.BIOF3_LOCAL_DATA_DIR = tmpDir;

const settings = require('../core/biof3-server/helpers/mcp-settings');

test('BLOCK-156 settings roundtrip: save → list 恒等（规范化字段齐备）', () => {
  const saved = settings.saveMcpServers([
    { id: 'fixture', command: 'node', args: ['a.js'], env: { K: 'V' } },
  ]);
  assert.equal(saved.error, undefined);
  const list = settings.listMcpServers();
  assert.equal(list.length, 1);
  assert.deepEqual(
    { ...list[0] },
    { id: 'fixture', command: 'node', args: ['a.js'], env: { K: 'V' }, autoConnect: true },
  );
});

test('BLOCK-156 upsert 单条新增与按 id 覆盖', () => {
  const added = settings.upsertMcpServer({ id: 'second', command: 'npx' });
  assert.equal(added.error, undefined);
  assert.equal(settings.listMcpServers().length, 2);

  const updated = settings.upsertMcpServer({ id: 'second', command: 'npx', args: ['-y', 'x'] });
  assert.equal(updated.error, undefined);
  const second = settings.getMcpServer('second');
  assert.deepEqual(second.args, ['-y', 'x']);
});

test('BLOCK-156 remove 按 id 删除；不存在=server_not_found', () => {
  assert.equal(settings.removeMcpServer('second').removed, 'second');
  assert.equal(settings.removeMcpServer('second').error, 'server_not_found');
});

test('BLOCK-156 非法条目 fail-closed：id 带空白/斜杠、缺 command、重复 id', () => {
  assert.equal(settings.normalizeServerEntry({ id: 'a b', command: 'x' }).error, 'invalid_id');
  assert.equal(settings.normalizeServerEntry({ id: 'a/b', command: 'x' }).error, 'invalid_id');
  assert.equal(settings.normalizeServerEntry({ id: 'ok' }).error, 'missing_command');
  const dup = settings.saveMcpServers([
    { id: 'dup', command: 'x' },
    { id: 'dup', command: 'y' },
  ]);
  assert.equal(dup.error, 'duplicate_id:dup');
  // 拒绝写入不落盘（原清单不变）
  assert.equal(settings.listMcpServers().length, 1);
});

test('BLOCK-156 损坏文件读取降级空清单（fail-open）', () => {
  fs.writeFileSync(settings.SETTINGS_FILE, '{not json', 'utf8');
  assert.deepEqual(settings.listMcpServers(), []);
});
