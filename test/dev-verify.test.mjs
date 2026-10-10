import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const toPath = (rel) => fileURLToPath(new URL(rel, import.meta.url));

// 直接相对仓库根加载（canonical 家在 petri-dev-infra skill 内）
const lib = require(toPath('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs'));
const { loadFlows } = require(toPath('../.agents/skills/petri-dev-infra/dev-verify/run.cjs'));

describe('dev-verify lib.cjs 纯逻辑', () => {
  it('filterPageTargets 只保留命中 URL 正则的 page 目标', () => {
    const targets = [
      { type: 'page', url: 'http://localhost:3000/project/p1' },
      { type: 'page', url: 'devtools://devtools/bundled/inspector.html' },
      { type: 'service_worker', url: 'http://localhost:3000/sw.js' },
      { type: 'page', url: 'http://localhost:5173/other' },
    ];
    const pages = lib.filterPageTargets(targets, /localhost:3000/);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].url, 'http://localhost:3000/project/p1');
    // 无正则时返回全部 page（devtools inspector 也是 page 类型）
    assert.equal(lib.filterPageTargets(targets).length, 3);
  });

  it('selectPageTarget 探测优先选中真主窗，全部不中回退首个候选', async () => {
    const candidates = [{ id: 'shell' }, { id: 'main' }];
    const fakeConnect = async (t) => ({ socket: { close() {} }, __target: t });
    const picked = await lib.selectPageTarget(candidates, {
      probe: async (_client, t) => t.id === 'main',
      connect: fakeConnect,
    });
    assert.equal(picked.id, 'main');
    const fallbackPicked = await lib.selectPageTarget(candidates, {
      probe: async () => false,
      fallbackSelector: async (_client, t) => t.id === 'shell',
      connect: fakeConnect,
    });
    assert.equal(fallbackPicked.id, 'shell');
    // 全部不中且无 fallbackSelector：回退首个候选
    assert.equal((await lib.selectPageTarget(candidates, { probe: async () => false, connect: fakeConnect })).id, 'shell');
    // 无 probe：直接首个
    assert.equal((await lib.selectPageTarget(candidates)).id, 'shell');
    // 空候选：null
    assert.equal(await lib.selectPageTarget([], { probe: async () => true }), null);
  });

  it('createRun 断言记录 + finish 证据落盘（契约与 block*-live 同构）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-verify-test-'));
    try {
      const run = lib.createRun({ name: 'My Flow_1', evidenceDir: dir });
      run.assert('a_pass', true, 'ok');
      run.assert('a_fail', false, 'bad');
      assert.equal(run.assertions.length, 2);
      assert.equal(run.allPass, false);
      const payload = await run.finish({ extra: 1 });
      assert.equal(payload.allPass, false);
      assert.equal(payload.extra, 1);
      const file = path.join(dir, 'my-flow-1-live.json');
      assert.ok(fs.existsSync(file), '证据 JSON 以 slug 命名落盘');
      const written = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.deepEqual(
        Object.keys(written).sort(),
        ['allPass', 'assertions', 'extra', 'finishedAt', 'name', 'startedAt'],
      );
      assert.equal(written.assertions[1].pass, false);

      // 全过场景
      const run2 = lib.createRun({ name: 'clean', evidenceDir: dir });
      run2.assert('b_pass', true);
      const p2 = await run2.finish();
      assert.equal(p2.allPass, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('createRun 空断言集合不判 allPass（诚实空态）', async () => {
    const run = lib.createRun({ name: 'empty' });
    const payload = await run.finish();
    assert.equal(payload.allPass, false);
  });
});

describe('dev-verify flow 注册表', () => {
  it('能发现内置 app-health flow 且元数据完整', () => {
    const flows = loadFlows();
    const health = flows.find((f) => f.id === 'app-health');
    assert.ok(health, 'app-health flow 已注册');
    assert.ok(typeof health.run === 'function');
    assert.ok(health.description);
  });
});
