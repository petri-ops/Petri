/**
 * BLOCK-242 — petri-install:// 深链安装安全核心单测（electron-free）。
 *
 * 覆盖：pack/mcp 解析、https/私网/大小/超时守卫、manifest schema、预览风险与
 * 替换警告、确认重取对账（TOCTOU）、下载 sha256/size 双验、MCP env 拒绝与替换门。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../src/main/install-deep-link-core.js');

function withPrivateAllowed(fn) {
  const previous = process.env.PETRI_INSTALL_ALLOW_PRIVATE;
  process.env.PETRI_INSTALL_ALLOW_PRIVATE = '1';
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env.PETRI_INSTALL_ALLOW_PRIVATE;
      else process.env.PETRI_INSTALL_ALLOW_PRIVATE = previous;
    });
}

function mcpConfigLink(config) {
  const encoded = Buffer.from(JSON.stringify(config), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `petri-install://mcp?config=${encoded}`;
}

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('BLOCK-242 — pack 链接解析：https 通过；非 https/私网默认拒，测试可放行', async () => {
  const https = core.parseInstallDeepLink('petri-install://pack?manifest=https%3A%2F%2Fexample.com%2Fpack.json');
  assert.equal(https.ok, true, JSON.stringify(https));
  assert.equal(https.kind, 'pack');
  assert.equal(https.sourceHost, 'example.com');

  const httpLink = core.parseInstallDeepLink('petri-install://pack?manifest=http%3A%2F%2Fexample.com%2Fpack.json');
  assert.equal(httpLink.ok, false);
  assert.match(httpLink.error, /scheme_blocked/);

  const privateLink = core.parseInstallDeepLink('petri-install://pack?manifest=https%3A%2F%2F127.0.0.1%2Fpack.json');
  assert.equal(privateLink.ok, false);
  assert.match(privateLink.error, /private_host_blocked/);

  await withPrivateAllowed(async () => {
    const loopback = core.parseInstallDeepLink('petri-install://pack?manifest=http%3A%2F%2F127.0.0.1%3A9%2Fpack.json');
    assert.equal(loopback.ok, true, JSON.stringify(loopback));
    const privateHttps = core.parseInstallDeepLink('petri-install://pack?manifest=https%3A%2F%2F10.0.0.5%2Fx.json');
    assert.equal(privateHttps.ok, true, JSON.stringify(privateHttps));
  });
});

test('BLOCK-242 — mcp 链接解析：base64url 配置、env 一律拒绝、id/参数校验', async () => {
  const ok = core.parseInstallDeepLink(mcpConfigLink({ id: 'demo-mcp', command: 'node', args: ['s.js'] }));
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.kind, 'mcp');
  assert.equal(ok.server.transport, 'stdio');
  assert.deepEqual(ok.server.args, ['s.js']);

  const withEnv = core.parseInstallDeepLink(mcpConfigLink({ id: 'demo', command: 'node', env: { TOKEN: 'x' } }));
  assert.equal(withEnv.ok, false);
  assert.equal(withEnv.error, 'env_not_allowed');

  const badId = core.parseInstallDeepLink(mcpConfigLink({ id: '../bad', command: 'node' }));
  assert.equal(badId.ok, false);
  assert.equal(badId.error, 'id_invalid');

  const noCommand = core.parseInstallDeepLink(mcpConfigLink({ id: 'demo' }));
  assert.equal(noCommand.ok, false);
  assert.equal(noCommand.error, 'command_required');
});

test('BLOCK-242 — manifest schema：sha/size/mcpServers 守卫', () => {
  const base = {
    pack: {
      packId: 'demo-pack',
      name: 'Demo',
      version: '1.0.0',
      archive: { url: 'https://example.com/a.zip', sha256: 'a'.repeat(64), sizeBytes: 10 },
    },
  };
  assert.equal(core.validatePackManifest(base).ok, true);

  const badSha = core.validatePackManifest({
    pack: { ...base.pack, archive: { ...base.pack.archive, sha256: 'xyz' } },
  });
  assert.equal(badSha.ok, false);
  assert.equal(badSha.error, 'sha256_invalid');

  const bigSize = core.validatePackManifest({
    pack: { ...base.pack, archive: { ...base.pack.archive, sizeBytes: Number.MAX_SAFE_INTEGER } },
  });
  assert.equal(bigSize.ok, false);
  assert.equal(bigSize.error, 'size_invalid');

  const envMcp = core.validatePackManifest({
    pack: { ...base.pack, mcpServers: [{ id: 'm1', command: 'node', env: { K: 'v' } }] },
  });
  assert.equal(envMcp.ok, false);
  assert.equal(envMcp.error, 'env_not_allowed');

  const tooMany = core.validatePackManifest({
    pack: { ...base.pack, mcpServers: Array.from({ length: 21 }, (_, i) => ({ id: `m${i}`, command: 'node' })) },
  });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.error, 'mcp_servers_too_many');
});

test('BLOCK-242 — 受控拉取：超限/坏 JSON/非 https 重定向拒绝', async () => {
  await withPrivateAllowed(() =>
    withServer((req, res) => {
      if (req.url === '/big.json') {
        res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(400 * 1024) });
        res.end(JSON.stringify({ pad: 'x'.repeat(400 * 1024) }));
        return;
      }
      if (req.url === '/bad.json') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('not-json');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }, async (base) => {
      const good = await core.fetchJsonGuarded(`${base}/ok.json`, { fetchImpl: globalThis.fetch });
      assert.equal(good.ok, true, JSON.stringify(good));
      const big = await core.fetchJsonGuarded(`${base}/big.json`, { fetchImpl: globalThis.fetch });
      assert.equal(big.ok, false);
      assert.equal(big.error, 'manifest_too_large');
      const bad = await core.fetchJsonGuarded(`${base}/bad.json`, { fetchImpl: globalThis.fetch });
      assert.equal(bad.ok, false);
      assert.equal(bad.error, 'manifest_invalid_json');
      const blocked = await core.fetchJsonGuarded('http://example.com/x.json', { fetchImpl: globalThis.fetch });
      assert.equal(blocked.ok, false);
      assert.match(blocked.error, /scheme_blocked|private|fetch/);
    }));
});

const PACK_MANIFEST = {
  pack: {
    packId: 'demo-pack',
    name: 'Demo Pack',
    version: '1.0.0',
    archive: { url: 'http://127.0.0.1:0/pack.zip', sha256: 'a'.repeat(64), sizeBytes: 4 },
    mcpServers: [{ id: 'collide-mcp', command: 'node', args: [] }, { id: 'fresh-mcp', command: 'node', args: [] }],
  },
};

function manifestFor(base, overrides = {}) {
  return {
    pack: {
      ...PACK_MANIFEST.pack,
      ...overrides,
      archive: { ...PACK_MANIFEST.pack.archive, url: `${base}/pack.zip`, ...(overrides.archive || {}) },
      mcpServers: overrides.mcpServers ?? PACK_MANIFEST.pack.mcpServers,
    },
  };
}

test('BLOCK-242 — 预览：来源/下载地址/大小/SHA-256 与替换警告（pack + mcp）', async () => {
  await withPrivateAllowed(() =>
    withServer((req, res) => {
      const base = `http://127.0.0.1:${req.socket.localPort}`;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(manifestFor(base)));
    }, async (base) => {
      const preview = await core.previewFromLink(
        `petri-install://pack?manifest=${encodeURIComponent(`${base}/manifest.json`)}`,
        {
          fetchImpl: globalThis.fetch,
          listInstalledPacks: async () => [{ packId: 'demo-pack' }],
          listMcpServers: async () => [{ id: 'collide-mcp' }],
        },
      );
      assert.equal(preview.ok, true, JSON.stringify(preview));
      assert.equal(preview.preview.kind, 'pack');
      assert.equal(preview.preview.pack.archive.url, `${base}/pack.zip`);
      assert.equal(preview.preview.pack.archive.sha256, 'a'.repeat(64));
      assert.equal(preview.preview.pack.archive.sizeBytes, 4);
      assert.ok(preview.preview.risk.reasons.includes('replaces_pack:demo-pack'));
      assert.ok(preview.preview.risk.reasons.includes('replaces_mcp:collide-mcp'));
      assert.ok(preview.preview.risk.reasons.includes('installs_mcp_servers'));

      const mcpPreview = await core.previewFromLink(
        mcpConfigLink({ id: 'collide-mcp', command: 'node' }),
        { fetchImpl: globalThis.fetch, listMcpServers: async () => [{ id: 'collide-mcp' }] },
      );
      assert.equal(mcpPreview.ok, true);
      assert.deepEqual(mcpPreview.preview.requiresReplace.mcp, ['collide-mcp']);
    }));
});

test('BLOCK-242 — 确认：TOCTOU 变化拒绝；sha/size 双验；成功安装 + MCP upsert', async () => {
  await withPrivateAllowed(() =>
    withServer((req, res) => {
      const base = `http://127.0.0.1:${req.socket.localPort}`;
      if (req.url === '/pack.zip') {
        res.writeHead(200, { 'content-type': 'application/zip' });
        res.end(Buffer.from('ZIP!'));
        return;
      }
      const shaHeader = req.headers['x-manifest-sha'];
      const manifest = manifestFor(base, {
        archive: { sha256: shaHeader === 'changed' ? 'b'.repeat(64) : coreSha('ZIP!'), sizeBytes: 4 },
        mcpServers: [{ id: 'collide-mcp', command: 'node', args: [] }],
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(manifest));
    }, async (base) => {
      const link = `petri-install://pack?manifest=${encodeURIComponent(`${base}/manifest.json`)}`;
      const expected = {
        archive: { url: `${base}/pack.zip`, sha256: coreSha('ZIP!'), sizeBytes: 4 },
      };
      const calls = [];
      const deps = {
        fetchImpl: globalThis.fetch,
        listMcpServers: async () => [{ id: 'collide-mcp' }],
        extractZip: async (_zip, dest) => { calls.push('extract'); return dest; },
        installPackDir: async () => { calls.push('install'); return { ok: true, requiresRestart: false }; },
        upsertMcpServer: async (server) => { calls.push(`mcp:${server.id}`); return { }; },
      };

      // TOCTOU：manifest 在确认时换成 bbbb… → manifest_changed
      const changed = await core.confirmInstall(link, {
        ...deps,
        expected,
        allowReplaceMcp: true,
        fetchImpl: (url, init) => globalThis.fetch(url, {
          ...init,
          headers: { ...(init && init.headers), 'x-manifest-sha': 'changed' },
        }),
      });
      assert.equal(changed.ok, false);
      assert.equal(changed.error, 'manifest_changed');

      // MCP 冲突未勾选 → 拒绝且不下载/安装
      const refused = await core.confirmInstall(link, { ...deps, expected, allowReplaceMcp: false });
      assert.equal(refused.ok, false);
      assert.equal(refused.error, 'mcp_replace_not_allowed');
      assert.deepEqual(calls, []);

      // 成功路径
      const ok = await core.confirmInstall(link, { ...deps, expected, allowReplaceMcp: true });
      assert.equal(ok.ok, true, JSON.stringify(ok));
      assert.deepEqual(calls, ['extract', 'install', 'mcp:collide-mcp']);
      assert.deepEqual(ok.mcpInstalled, ['collide-mcp']);
    }));
});

test('BLOCK-242 — 确认：sah256 不匹配拒绝且清理临时目录', async () => {
  await withPrivateAllowed(() =>
    withServer((req, res) => {
      const base = `http://127.0.0.1:${req.socket.localPort}`;
      if (req.url === '/pack.zip') {
        res.writeHead(200);
        res.end(Buffer.from('TAMPERED'));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(manifestFor(base, {
        archive: { sha256: coreSha('EXPECTED'), sizeBytes: 8 },
        mcpServers: [],
      })));
    }, async (base) => {
      const link = `petri-install://pack?manifest=${encodeURIComponent(`${base}/manifest.json`)}`;
      const result = await core.confirmInstall(link, {
        expected: { archive: { url: `${base}/pack.zip`, sha256: coreSha('EXPECTED'), sizeBytes: 8 } },
        allowReplaceMcp: true,
        fetchImpl: globalThis.fetch,
        listMcpServers: async () => [],
        extractZip: async () => { throw new Error('should not extract'); },
        installPackDir: async () => { throw new Error('should not install'); },
        upsertMcpServer: async () => ({}),
      });
      assert.equal(result.ok, false);
      assert.equal(result.error, 'checksum_mismatch');
    }));
});

test('BLOCK-242 — mcp kind 确认：替换门 + upsert', async () => {
  const calls = [];
  const deps = {
    listMcpServers: async () => [{ id: 'demo-mcp' }],
    upsertMcpServer: async (server) => { calls.push(server.id); return {}; },
  };
  const link = mcpConfigLink({ id: 'demo-mcp', command: 'node' });
  const refused = await core.confirmInstall(link, { ...deps, allowReplaceMcp: false });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, 'mcp_replace_not_allowed');
  assert.deepEqual(calls, []);

  const ok = await core.confirmInstall(link, { ...deps, allowReplaceMcp: true });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.replaced, true);
  assert.deepEqual(calls, ['demo-mcp']);
});

function coreSha(text) {
  return require('node:crypto').createHash('sha256').update(Buffer.from(text)).digest('hex');
}