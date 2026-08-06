// P0-1 止血：远程 artifact 缺 sha256 必须 fail-closed（收口 "Week 4 placeholder"）
// 依据：eval-reports/code-review-2026-08-06.md P0-1
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// plugin-manager 顶层用 app.getPath，纯 Node 下必须用 BIOF3_LOCAL_DATA_DIR 旁路
process.env.BIOF3_LOCAL_DATA_DIR = process.env.BIOF3_LOCAL_DATA_DIR || '/tmp/biof3-test-data';

const require = createRequire(import.meta.url);
const pm = require('../src/plugin-manager.js');

test('assertArtifactChecksumDeclared: sha256 缺失抛 CHECKSUM_MISSING', () => {
  assert.throws(
    () => pm.assertArtifactChecksumDeclared('plugin', 'demo', 'macos-arm64', { url: 'https://a/b.zip', sha256: null }),
    (e) => e.code === 'CHECKSUM_MISSING' && e.pluginId === 'demo' && e.platform === 'macos-arm64'
  );
});

test('assertArtifactChecksumDeclared: sha256 undefined 同样拒绝', () => {
  assert.throws(
    () => pm.assertArtifactChecksumDeclared('runtime', 'rt', 'macos-arm64', { url: 'https://a/b.zip' }),
    (e) => e.code === 'CHECKSUM_MISSING'
  );
});

test('assertArtifactChecksumDeclared: sha256 存在时放行', () => {
  pm.assertArtifactChecksumDeclared('plugin', 'demo', 'macos-arm64', { sha256: 'a'.repeat(64) });
});

test('installPlugin: 远程 artifact 缺 sha256 在下载前 fail-fast', async () => {
  // manifest 直接注入（新签名），url 指向不可达地址——若未 fail-fast 会在下载阶段才失败
  await assert.rejects(
    () =>
      pm.installPlugin({
        id: 'unsigned-plugin',
        platform: 'macos-arm64',
        manifest: {
          id: 'unsigned-plugin',
          version: '1.0.0',
          artifacts: {
            'macos-arm64': { url: 'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/never/downloaded.zip', sha256: null },
          },
        },
      }),
    (e) => e.code === 'CHECKSUM_MISSING'
  );
});
