/**
 * BLOCK-84 P2 实机抓真（2026-09-12）— dev 渲染器 origin 白名单必须覆盖
 * localhost / 127.0.0.1 双变体。
 *
 * 背景（真实故障链）：
 *   dev Electron 页面跑在 http://127.0.0.1:3000（Vite 显式 host:'127.0.0.1'），
 *   而后端 CORS 白名单只含 http://localhost:3000（dev 模式 backendPorts.renderer
 *   恒为 null，白名单只能由 rendererDevUrl 推导，旧实现只 add 了 .origin 一个值）。
 *   → 后端响应缺 Access-Control-Allow-Origin → 浏览器按同源策略丢弃这个 200
 *   → 渲染进程 fetch 抛 `TypeError: Failed to fetch`（网络层其实 200）
 *   → project-store.getProject 的 catch 吞错返回 null
 *   → ProjectWorkspace 显示「项目不存在或无权访问」
 *   → 插件商店「领域包」分区根本渲染不出来。
 *
 * 该回归的隐蔽点：CDP Network 域能看到 200，只有渲染进程 fetch 会失败；
 * 上游错误屏的文案与真实原因（CORS）完全无关，极易被误判为后端/数据问题。
 * 本测试锁死"双变体必须都在白名单里"这条不变量。
 *
 * 运行：cd desktop && node --test test/env-coordinator-trusted-origins.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const { computeTrustedRendererOrigins } = await import(
  pathToFileURL(path.join(root, 'src/main/env-coordinator.js')).href
);

test('BLOCK-84 dev: localhost dev URL yields both localhost and 127.0.0.1 variants', () => {
  const set = computeTrustedRendererOrigins({
    isDev: true,
    rendererDevUrl: 'http://localhost:3000',
    rendererPort: null,
  });
  assert.ok(set.has('http://localhost:3000'), 'must trust http://localhost:3000');
  assert.ok(
    set.has('http://127.0.0.1:3000'),
    'must also trust http://127.0.0.1:3000 (Vite may bind IPv4; page origin drifts)',
  );
});

test('BLOCK-84 dev: 127.0.0.1 dev URL yields both variants (order-independent)', () => {
  const set = computeTrustedRendererOrigins({
    isDev: true,
    rendererDevUrl: 'http://127.0.0.1:3100',
    rendererPort: null,
  });
  assert.ok(set.has('http://127.0.0.1:3100'));
  assert.ok(set.has('http://localhost:3100'), 'host variant must be symmetric');
});

test('BLOCK-84 dev: non-default port is carried through, not hardcoded to 3000', () => {
  const set = computeTrustedRendererOrigins({
    isDev: true,
    rendererDevUrl: 'http://localhost:4321',
    rendererPort: null,
  });
  assert.ok(set.has('http://localhost:4321'));
  assert.ok(set.has('http://127.0.0.1:4321'));
  assert.ok(!set.has('http://localhost:3000'), 'must not leak the default port');
});

test('BLOCK-84: existing PETRI_TRUSTED_DESKTOP_ORIGINS entries are preserved', () => {
  const set = computeTrustedRendererOrigins({
    existing: 'http://localhost:9999 , http://10.0.0.5:8080',
    isDev: true,
    rendererDevUrl: 'http://localhost:3000',
    rendererPort: null,
  });
  assert.ok(set.has('http://localhost:9999'), 'pre-existing entry must survive');
  assert.ok(set.has('http://10.0.0.5:8080'), 'whitespace must be trimmed');
  assert.ok(set.has('http://127.0.0.1:3000'), 'dev variants still added');
});

test('BLOCK-84 packaged: renderer port drives the whitelist, dev branch is inert', () => {
  const set = computeTrustedRendererOrigins({
    isDev: false,
    rendererDevUrl: 'http://localhost:3000',
    rendererPort: 3002,
  });
  assert.ok(set.has('http://localhost:3002'));
  assert.ok(set.has('http://127.0.0.1:3002'));
  // packaged 下 rendererDevUrl 分支不生效，不应把 dev 端口混进生产白名单。
  assert.ok(!set.has('http://127.0.0.1:3000'), 'dev origins must not leak into packaged set');
});

test('BLOCK-84: malformed rendererDevUrl degrades gracefully (no throw)', () => {
  const set = computeTrustedRendererOrigins({
    existing: 'http://localhost:5555',
    isDev: true,
    rendererDevUrl: 'not-a-url',
    rendererPort: null,
  });
  assert.ok(set.has('http://localhost:5555'), 'existing entries survive a bad dev URL');
  assert.strictEqual(set.size, 1, 'nothing extra is invented');
});

test('BLOCK-84: consumer boundary honours the computed set (integration, no Electron)', () => {
  // 真正决定放行的是 core/shared-backend/local-request-boundary.js。这里直接
  // 把白名单喂给它，验证"页面 origin ∈ 计算集合 ⇒ 被判定为可信"。
  const set = computeTrustedRendererOrigins({
    isDev: true,
    rendererDevUrl: 'http://localhost:3000',
    rendererPort: null,
  });
  process.env.PETRI_TRUSTED_DESKTOP_ORIGINS = [...set].join(',');
  const boundary = require(path.join(root, 'core/shared-backend/local-request-boundary.js'));
  for (const origin of set) {
    assert.ok(
      boundary.isTrustedDesktopOrigin(origin),
      `boundary must trust computed origin ${origin}`,
    );
  }
  assert.ok(
    !boundary.isTrustedDesktopOrigin('http://evil.example.com'),
    'boundary must still reject untrusted origins',
  );
  delete process.env.PETRI_TRUSTED_DESKTOP_ORIGINS;
});
