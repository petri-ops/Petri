import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const generation = require('../core/petri-server/helpers/model3d-generation-provider.js');
const assets = require('../core/petri-server/helpers/model3d-assets.js');

function workspace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gen-')); }

function withEnv(values, fn) {
  const saved = {};
  for (const key of Object.keys(values)) {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  return Promise.resolve().then(fn).finally(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

test('BLOCK-322 P5-02 生成服务 — 默认 none，零出站；缺 key 如实报', async () => {
  await withEnv({ PETRI_MODEL3D_GENERATION_PROVIDER: undefined, TRIPO_API_KEY: undefined, PETRI_TRIPO_API_KEY: undefined, PETRI_MODEL3D_GENERATION_API_KEY: undefined }, async () => {
    const probe = generation.probeGenerationProvider();
    assert.equal(probe.status, 'unavailable');
    assert.equal(probe.reason, 'generation_provider_none');
    assert.equal(probe.privacy.external, true);
    const result = await generation.generateModel({ prompt: 'a small bracket' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'generation_provider_none');
  });
  await withEnv({ PETRI_MODEL3D_GENERATION_PROVIDER: 'tripo', TRIPO_API_KEY: undefined, PETRI_TRIPO_API_KEY: undefined, PETRI_MODEL3D_GENERATION_API_KEY: undefined }, async () => {
    const probe = generation.probeGenerationProvider();
    assert.equal(probe.status, 'unavailable');
    assert.equal(probe.reason, 'generation_key_missing');
    assert.equal(probe.privacy.external, true);
  });
});

test('BLOCK-322 P5-02 生成服务 — mock 只做本地验证，产出真实 GLB 并走资产链', async () => {
  await withEnv({ PETRI_MODEL3D_GENERATION_PROVIDER: 'mock' }, async () => {
    const probe = generation.probeGenerationProvider();
    assert.equal(probe.status, 'ready');
    assert.equal(probe.provider, 'mock');
    assert.equal(probe.privacy.external, false);
    const generated = await generation.generateModel({ prompt: 'a local test cube' });
    assert.equal(generated.ok, true, JSON.stringify(generated));
    assert.equal(generated.provider, 'mock');
    assert.equal(generated.glb.subarray(0, 4).toString('ascii'), 'glTF');
    const root = workspace();
    const imported = await assets.generateAndImport({ workspaceRoot: root, prompt: 'a local test cube', name: 'mock-cube' });
    assert.equal(imported.ok, true, JSON.stringify(imported));
    assert.equal(imported.node.type, 'mesh-reference');
    assert.equal(imported.generation.provider, 'mock');
    assert.match(imported.asset.sha256, /^[a-f0-9]{64}$/);
    assert.equal(fs.readFileSync(path.join(root, imported.asset.path)).subarray(0, 4).toString('ascii'), 'glTF');
    assert.equal(imported.provenance.generator, 'mock');
  });
});

test('BLOCK-322 P5-02 生成服务 — Tripo v3 请求/轮询/下载形状（注入 fetch，零真实出网）', async () => {
  await withEnv({
    PETRI_MODEL3D_GENERATION_PROVIDER: 'tripo',
    TRIPO_API_KEY: 'test-key-do-not-call',
    PETRI_MODEL3D_GENERATION_BASE_URL: 'https://openapi.tripo3d.com/v3',
  }, async () => {
    const calls = [];
    const glb = Buffer.from('glTF-test-payload');
    const fetchImpl = async (url, options) => {
      calls.push({ url: String(url), method: options?.method || 'GET', headers: options?.headers || {}, body: options?.body || null });
      if (String(url).endsWith('/generation/text-to-model')) {
        return { ok: true, status: 200, json: async () => ({ code: 0, data: { task_id: 'task-1' } }) };
      }
      if (String(url).includes('/tasks/task-1')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ task_id: 'task-1', status: 'success', output: { model_url: 'https://tripo3d.com/model.glb' } }),
        };
      }
      if (String(url).endsWith('/model.glb')) {
        return { ok: true, status: 200, headers: new Map([['content-length', String(glb.length)]]), arrayBuffer: async () => glb };
      }
      throw new Error(`unexpected url: ${url}`);
    };
    const result = await generation.generateModel({ prompt: 'a test bracket', fetchImpl });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.provider, 'tripo');
    assert.equal(result.taskId, 'task-1');
    assert.equal(result.glb.toString(), 'glTF-test-payload');
    assert.equal(calls[0].url, 'https://openapi.tripo3d.com/v3/generation/text-to-model');
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].headers.Authorization, 'Bearer test-key-do-not-call');
    assert.deepEqual(JSON.parse(calls[0].body), {
      prompt: 'a test bracket', model: 'v3.1-20260211', texture: true, pbr: true, texture_quality: 'detailed',
    });
    assert.equal(calls[1].url, 'https://openapi.tripo3d.com/v3/tasks/task-1');
    assert.equal(calls[2].url, 'https://tripo3d.com/model.glb');
  });
});

test('BLOCK-322 P5-02 生成服务 — prompt 边界/失败态/可信下载域名 fail-closed', async () => {
  await withEnv({ PETRI_MODEL3D_GENERATION_PROVIDER: 'mock' }, async () => {
    assert.equal((await generation.generateModel({ prompt: 'a' })).error, 'generation_prompt_too_short');
    assert.equal((await generation.generateModel({ prompt: 'x'.repeat(1025) })).error, 'generation_prompt_too_long');
  });
  await withEnv({
    PETRI_MODEL3D_GENERATION_PROVIDER: 'tripo',
    TRIPO_API_KEY: 'test-key',
    PETRI_MODEL3D_GENERATION_BASE_URL: 'https://openapi.tripo3d.com/v3',
  }, async () => {
    const fetchImpl = async (url) => {
      if (String(url).endsWith('/generation/text-to-model')) {
        return { ok: true, status: 200, json: async () => ({ data: { task_id: 'task-2' } }) };
      }
      if (String(url).includes('/tasks/task-2')) {
        return { ok: true, status: 200, json: async () => ({ status: 'failed', message: 'bad prompt' }) };
      }
      throw new Error('unexpected');
    };
    const failed = await generation.generateModel({ prompt: 'a bracket', fetchImpl });
    assert.equal(failed.ok, false);
    assert.equal(failed.error, 'generation_failed');
    assert.equal(failed.status, 'failed');
  });
});
