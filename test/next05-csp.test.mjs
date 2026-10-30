import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildCspHeader } = require('../src/main/csp-config.js');

test('NEXT-05 CSP — connect-src 放行 blob: 以支持 GLB/STL/OBJ 本地文件预览', () => {
  for (const dev of [true, false]) {
    const header = buildCspHeader(dev);
    assert.match(header, /connect-src 'self' blob: /);
    assert.match(header, /img-src 'self' data: blob:/);
    assert.match(header, /worker-src 'self' blob:/);
    // BLOCK-322 P2-05 — 视频产物经 fetch→blob: 喂 <video>：跨源 media 会被 Chromium 的
    // URL safety check 直接拒（实测 MEDIA_ELEMENT_ERROR: Media load rejected by URL safety
    // check），而没有 media-src 时它回落 default-src 'self' 连 blob 也挡。
    assert.match(header, /media-src 'self' blob:/);
    assert.match(header, /object-src 'none'/);
  }
  assert.equal(buildCspHeader(false).includes("'unsafe-eval'"), false);
  assert.equal(buildCspHeader(false).includes("script-src 'self';"), true);
});
