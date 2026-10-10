/**
 * BLOCK-163 W3 P6（DIST-3⇄CAP-5）— 插件权限词表契约测试。
 *
 * 钉住：pack.json 可选 permissions[] 六词表（filesystem:read / filesystem:write /
 * network / process:spawn / runtime-install / data:demo）；未知词拒装；
 * 不声明 = 现状全权（存量零破坏）；记录持久化 + 可用清单透出（安装确认展示数据源）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'b163-permissions-'));
process.env.BIOF3_LOCAL_DATA_DIR = tmpData;

const packRegistry = require(path.join(ROOT, 'core/shared-backend/pack-registry.js'));

function makePack(name, packExtra = {}) {
  const packRoot = path.join(tmpData, name);
  fs.mkdirSync(path.join(packRoot, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId: name, name, version: '1.0.0', ...packExtra,
  }));
  fs.writeFileSync(path.join(packRoot, 'plugins', 'installed.json'), JSON.stringify([]));
  return packRoot;
}

test('BLOCK-163 权限词表：不声明=全权（存量零破坏）；合法六词通过', () => {
  const bareRoot = makePack('perm-bare');
  const bare = packRegistry.validatePackDir(bareRoot);
  assert.equal(bare.ok, true, JSON.stringify(bare));
  assert.equal(bare.pack.permissions, undefined, '不声明=现状全权（缺省 undefined）');

  const fullRoot = makePack('perm-full', {
    permissions: ['filesystem:read', 'filesystem:write', 'network', 'process:spawn', 'runtime-install', 'data:demo'],
  });
  const full = packRegistry.validatePackDir(fullRoot);
  assert.equal(full.ok, true, JSON.stringify(full));
  assert.deepEqual(full.pack.permissions.sort(), [
    'data:demo', 'filesystem:read', 'filesystem:write', 'network', 'process:spawn', 'runtime-install',
  ]);
});

test('BLOCK-163 权限词表：未知词/非字符串/非数组拒装', () => {
  for (const permissions of [
    ['filesystem:root'],           // 未知词
    ['exec:arbitrary'],            // 未知词
    ['filesystem:read', 42],       // 非字符串
    'network',                     // 非数组
  ]) {
    const root = makePack(`perm-bad-${Math.abs(hash(JSON.stringify(permissions)))}`, { permissions });
    const r = packRegistry.validatePackDir(root);
    assert.equal(r.ok, false, `${JSON.stringify(permissions)} 应拒装`);
    assert.match(r.error || '', /permission/);
  }
  function hash(str) { let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) | 0; return h; }
});

test('BLOCK-163 权限词表：安装记录持久化 permissions + available 清单透出', () => {
  const root = makePack('perm-store', {
    permissions: ['filesystem:read', 'network'],
  });
  const installed = packRegistry.installPack(tmpData, root);
  assert.equal(installed.ok, true, JSON.stringify(installed));
  const record = packRegistry.readInstalledPacks(tmpData).find((p) => p.packId === 'perm-store');
  assert.deepEqual(record.permissions, ['filesystem:read', 'network']);

  // discover 候选目录本身即包根（validatePackDir(dir) 直查）→ extraDirs 传包根
  const avail = packRegistry.discoverAvailablePacks({ extraDirs: [root] });
  const entry = avail.find((p) => p.packId === 'perm-store');
  assert.ok(entry, 'discover 应透出 perm-store');
  assert.deepEqual(entry.permissions, ['filesystem:read', 'network']);
});
