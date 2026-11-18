import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// BLOCK-464 P4-C — pack.json provides.composeTemplates 投影契约（HK-01 红绿先行）。
// 领域包经 manifest 段贡献 compose spec 模板；投影 fail-closed：
//   白名单字段 {id,title,description?,spec}、上限 8 条、spec 4KB、id 唯一、
//   spec 形状与 compose spec 同构（version=1/root/nodes——投影侧轻校验，非法条目丢弃+diagnostic，
//   完整校验仍归前端 parseComposeSpec（消费侧 fail-closed 双闸）。
// REST /api/packs/contributions 零改动自动透出（消费面 v1 = 模型可读）。

const TEMPLATE_SPEC = {
  version: 1,
  root: 'card1',
  nodes: { card1: { kind: 'card', title: '领域模板' } },
};

function makeFakePack(t, provides) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block464-pack-'));
  const packRoot = path.join(root, 'demo-pack');
  fs.mkdirSync(packRoot, { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({ name: 'demo-pack', version: '1.0.0', provides }, null, 2));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return packRoot;
}

test('BLOCK-464 前置：loadPackContributions 支持 testRoot 注入（投影可测形态）', () => {
  const { loadPackContributions } = require('../core/petri-server/helpers/pack-contributions.js');
  // 只测函数可调用 + 返回形状（packs/diagnostics），注入形态由实现提供
  const result = loadPackContributions({ testRoot: os.tmpdir() });
  assert.ok(Array.isArray(result.packs));
  assert.ok(Array.isArray(result.diagnostics));
});

test('BLOCK-464: 合法 composeTemplates 投影透出（含 spec 形状轻校验）', (t) => {
  const { loadPackContributions } = require('../core/petri-server/helpers/pack-contributions.js');
  const packRoot = makeFakePack(t, {
    composeTemplates: [
      { id: 'bio-abundance', title: '丰度表模板', description: '领域模板', spec: TEMPLATE_SPEC },
    ],
  });
  const result = loadPackContributions({ testRoot: path.dirname(packRoot) });
  const pack = result.packs.find((p) => p.packId === 'demo-pack');
  assert.ok(pack, `投影应含 demo-pack: ${JSON.stringify(result).slice(0, 300)}`);
  assert.equal(pack.composeTemplates.length, 1);
  assert.equal(pack.composeTemplates[0].id, 'bio-abundance');
  assert.equal(pack.composeTemplates[0].title, '丰度表模板');
  assert.equal(pack.composeTemplates[0].spec.version, 1);
});

test('BLOCK-464: 非法条目 fail-closed 丢弃 + diagnostic（缺 spec/坏形状/坏 id/重复 id）', (t) => {
  const { loadPackContributions } = require('../core/petri-server/helpers/pack-contributions.js');
  const packRoot = makeFakePack(t, {
    composeTemplates: [
      { id: 'ok', title: '合法', spec: TEMPLATE_SPEC },
      { id: 'no-spec', title: '缺 spec' },
      { id: 'bad-spec', title: '坏 spec 形状', spec: { version: 9, root: 'x', nodes: {} } },
      { title: '缺 id', spec: TEMPLATE_SPEC },
      { id: 'dup', title: '重复一', spec: TEMPLATE_SPEC },
      { id: 'dup', title: '重复二', spec: TEMPLATE_SPEC },
    ],
  });
  const result = loadPackContributions({ testRoot: path.dirname(packRoot) });
  const pack = result.packs.find((p) => p.packId === 'demo-pack');
  assert.ok(pack);
  // first-wins 沿 views 语义：合法 ok + dup 首个在场，其余（no-spec/bad-spec/缺 id/dup 次个）全弃
  assert.deepEqual(pack.composeTemplates.map((row) => row.id), ['ok', 'dup'], `非法条目必须丢弃: ${JSON.stringify(pack.composeTemplates)}`);
  assert.ok(result.diagnostics.filter((d) => d.contribution === 'composeTemplates').length >= 3, '每次丢弃必须留 diagnostic');
});

test('BLOCK-464: 上限 8 条 + spec 4KB 截断/拒绝（LIMITS 模式）', (t) => {
  const { loadPackContributions } = require('../core/petri-server/helpers/pack-contributions.js');
  const big = JSON.parse(JSON.stringify(TEMPLATE_SPEC));
  big.nodes.pad = { kind: 'card', title: 'x'.repeat(4200) };
  const packRoot = makeFakePack(t, {
    composeTemplates: Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, title: `T${i}`, spec: i === 9 ? big : TEMPLATE_SPEC })),
  });
  const result = loadPackContributions({ testRoot: path.dirname(packRoot) });
  const pack = result.packs.find((p) => p.packId === 'demo-pack');
  assert.ok(pack);
  assert.ok(pack.composeTemplates.length <= 8, `超过 8 条必须截断: ${pack.composeTemplates.length}`);
  assert.ok(pack.composeTemplates.every((row) => JSON.stringify(row.spec).length <= 4096), 'spec 超 4KB 必须拒绝');
});

test('BLOCK-464: provides 非 composeTemplates 数组 → invalid_shape diagnostic（不炸穿其它段）', (t) => {
  const { loadPackContributions } = require('../core/petri-server/helpers/pack-contributions.js');
  const packRoot = makeFakePack(t, { composeTemplates: 'nope', views: [] });
  const result = loadPackContributions({ testRoot: path.dirname(packRoot) });
  assert.ok(result.diagnostics.some((d) => d.contribution === 'composeTemplates' && d.code === 'invalid_shape'));
});
