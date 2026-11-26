/**
 * 创作包 generate.* 内置化 HK-01（owner 裁决「这些包应该是内置的呀」）。
 * 四组断言：工具注册齐备+恒等 / 内核零 provider 硬编码 / 通用 handler 派发描述符 / 凭据注入零泄露。
 * 会话数据只读；本测试不调用真实 Ark。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENT_TOOLS = path.join(ROOT, 'core', 'petri-server', 'agent-tools');
const NAMES = ['generate.image', 'generate.video', 'generate.model3d'];

// registry.js 模块加载期要求 DB 可用——自举临时库（与 workspace-exec-error-hint 同款）。
{
  const fs_ = require_('node:fs');
  const os_ = require_('node:os');
  const path_ = require_('node:path');
  const Database = require_(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const dir = fs_.mkdtempSync(path_.join(os_.tmpdir(), 'gen-builtin-db-'));
  const boot = new Database(path_.join(dir, 'petri.db'));
  const migrations = path.join(ROOT, 'src', 'migrations');
  for (const f of fs_.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs_.readFileSync(path_.join(migrations, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path_.join(dir, 'petri.db');
  process.on('exit', () => { try { fs_.rmSync(dir, { recursive: true, force: true }); } catch {} });
}

test('HK-01-1：三工具注册齐备（defs/handler/contract），且 ⋃域 === TOOL_DEFS', () => {
  const defs = require_(path.join(AGENT_TOOLS, 'tool-defs.js'));
  const registry = require_(path.join(AGENT_TOOLS, 'registry.js'));
  const names = defs.TOOL_DEFS.map((t) => t.function.name);
  for (const name of NAMES) {
    assert.ok(names.includes(name), `${name} 必须在 TOOL_DEFS 中`);
    assert.equal(typeof registry.getToolHandler(name), 'function', `${name} 必须有 handler`);
    assert.ok(registry.getToolContract(name), `${name} 必须有 contract`);
  }
  const union = new Set(Object.values(defs.DOMAIN_TOOL_DEFS).flat().map((t) => t.function.name));
  assert.deepEqual([...union].sort(), [...new Set(names)].sort(), '域映射并集须与 TOOL_DEFS 恒等');
});

test('HK-01-2：内核 generate 接线零 provider 领域硬编码', () => {
  const files = [
    path.join(AGENT_TOOLS, 'generate-tools.js'),
    path.join(AGENT_TOOLS, 'registry.js'),
    path.join(AGENT_TOOLS, 'tool-defs.js'),
    path.join(AGENT_TOOLS, 'tool-defs', 'generate.js'),
    path.join(AGENT_TOOLS, 'tool-metadata.js'),
  ];
  let all = '';
  for (const f of files) all += fs.readFileSync(f, 'utf8');
  assert.doesNotMatch(all, /seedream|seedance|seed3d|hyper3d|hyper3d-gen2|doubao/i);
});

function seedPack(root, { pluginBody, exportName = 'fakeGenerate', credentialProvider = 'ark' } = {}) {
  const pluginsDir = path.join(root, 'plugins', 'fake-plugin');
  fs.mkdirSync(pluginsDir, { recursive: true });
  fs.writeFileSync(path.join(pluginsDir, 'index.js'), pluginBody);
  fs.mkdirSync(path.join(root, 'registry'), { recursive: true });
  fs.writeFileSync(path.join(root, 'registry', 'generate-tools.json'), JSON.stringify({
    version: 'create-pack-registry/v1',
    tools: [{ id: 'generate.image', exportName, credentialProvider, entry: 'plugins/fake-plugin/index.js' }],
  }));
}

test('HK-01-3：通用 handler 动态派发——产出 artifact 描述符，outDir 在 dataDir 下', async () => {
  const { createGenerateHandler } = require_(path.join(AGENT_TOOLS, 'generate-tools.js'));
  const secret = 'sk-test-DO-NOT-LEAK-123';
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-builtin-'));
  const outDir = path.join(tmp, 'out');
  seedPack(path.join(tmp, 'pack'), {
    credentialProvider: 'ark',
    pluginBody: `'use strict';
      const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
      module.exports.fakeGenerate = async (input, deps) => {
        if (deps.apiKey !== '${secret}') throw new Error('api_key_not_injected');
        const p = path.join(deps.outDir, 'out.png');
        fs.mkdirSync(deps.outDir, { recursive: true });
        fs.writeFileSync(p, Buffer.from('png-bytes'));
        return { path: p, sha256: crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),
                 mime: 'image/png', source: { provider: 'fake', prompt: input.prompt } };
      };`,
  });
  try {
    const handler = createGenerateHandler('generate.image', {
      packRoot: path.join(tmp, 'pack'), apiKey: secret, outDir,
      fetch: async () => { throw new Error('not used'); },
    });
    const result = await handler({ prompt: 'test' });
    assert.equal(result.mime, 'image/png');
    assert.equal(result.sha256, require_('node:crypto').createHash('sha256').update(fs.readFileSync(result.path)).digest('hex'));
    assert.ok(result.path.startsWith(outDir), '产物须落在注入的 outDir 下');
    assert.equal(result.source.provider, 'fake');
    assert.ok(!JSON.stringify(result).includes(secret), 'key 不得进入返回描述符');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('HK-01-4：entry 路径越界被拒（内置包边界 fail-closed）', async () => {
  const { createGenerateHandler } = require_(path.join(AGENT_TOOLS, 'generate-tools.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-builtin-bound-'));
  seedPack(path.join(tmp, 'pack'), { pluginBody: 'module.exports.fakeGenerate = async () => ({ ok: true });' });
  fs.writeFileSync(path.join(tmp, 'pack', 'registry', 'generate-tools.json'), JSON.stringify({
    version: 'create-pack-registry/v1',
    tools: [{ id: 'generate.image', exportName: 'fakeGenerate', entry: '../../escape.js' }],
  }));
  try {
    const handler = createGenerateHandler('generate.image', {
      packRoot: path.join(tmp, 'pack'), apiKey: 'k', outDir: path.join(tmp, 'out'),
    });
    await assert.rejects(() => handler({ prompt: 'x' }), /generate_entry_out_of_bounds/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
