/**
 * BLOCK-157 加映（UI-481 过目抓真）— 领域包整包启停契约测试。
 *
 * 背景：用户货架上的插件面是「包交付插件行」（pack 体系），商店安装卡片在
 * OSS 不可达环境下为零 → DIST-1 的 installed.json 启停在用户可见面上缺席。
 * 本加映把启停接到包卡片：packs/installed.json 记录级 enabled 标志（缺省启用）
 * + server.js 装配循环跳过停用包（该包插件源与 tool-registry 注册整体不生效）。
 * 红绿先行：先红（setPackEnabled 不存在/接线缺失）后实现转绿。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

const packRegistry = require(path.join(ROOT, 'core/shared-backend/pack-registry.js'));

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'b157-pack-enabled-'));
// 造一个最小已装包记录（readInstalledPacks 只认 packId+packRoot；enabled 语义在本加映）
const packRoot = path.join(tmpData, 'pack-fixture');
fs.mkdirSync(packRoot, { recursive: true });
fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({ packId: 'pack-fixture', name: '夹具包', version: '1.0.0' }));
packRegistry.writeInstalledPacks(tmpData, [
  { packId: 'pack-fixture', packRoot, version: '1.0.0' },
]);

test('BLOCK-157 加映 readInstalledPacks：enabled 缺省=启用（存量零破坏），记录字段透传', () => {
  const packs = packRegistry.readInstalledPacks(tmpData);
  assert.equal(packs.length, 1);
  assert.equal(packs[0].enabled, true, '无 enabled 字段 = 启用（归一化补齐）');
});

test('BLOCK-157 加映 setPackEnabled：翻转持久化 + 未知包诚实失败 + 免重装（packRoot 不动）', () => {
  const off = packRegistry.setPackEnabled(tmpData, 'pack-fixture', false);
  assert.equal(off.ok, true, JSON.stringify(off));
  assert.equal(packRegistry.readInstalledPacks(tmpData)[0].enabled, false);
  assert.ok(fs.existsSync(path.join(packRoot, 'pack.json')), '停用不卸载：包文件不动');

  const on = packRegistry.setPackEnabled(tmpData, 'pack-fixture', true);
  assert.equal(on.ok, true);
  assert.equal(packRegistry.readInstalledPacks(tmpData)[0].enabled, true);

  const missing = packRegistry.setPackEnabled(tmpData, 'no-such-pack', true);
  assert.equal(missing.ok, false, '未知包诚实失败');
});

test('BLOCK-157 加映 接线钉：server.js 装配循环必须尊重停用包（源码扫描守卫）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/biof3-server/server.js'), 'utf8');
  assert.match(src, /readInstalledPacks/, 'server.js 应读已装包记录');
  assert.match(src, /enabled === false/, '装配循环应跳过 enabled === false 的包（停用即不注册该包插件源）');
});

test('BLOCK-157 加映 IPC 面钉：pack:set-enabled 通道双侧登记（防漂移）', () => {
  const channels = fs.readFileSync(path.join(ROOT, 'src/ipc/channels.js'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');
  assert.match(channels, /setEnabled:\s*'pack:set-enabled'/, 'channels 应登记 pack:set-enabled');
  assert.match(preload, /pack:set-enabled/, 'preload 应包装 pack:set-enabled');
});
