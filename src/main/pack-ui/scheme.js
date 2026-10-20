'use strict';

/**
 * BLOCK-216 Q5 — `petri-pack://` 只读沙箱宿主。
 *
 * 每个领域包一个独立 origin（`petri-pack://<packId>`），iframe 以
 * `sandbox="allow-scripts allow-same-origin"` 加载：同 origin 让包内脚本/样式
 * 可加载，跨 origin 让包页无法访问宿主 DOM。协议 handler 只服务**已安装且启用**
 * 的包内真实文件，路径判定复用 shared-pack-assets 单源；不暴露 packRoot。
 *
 * - registerPackSchemePrivileges()：必须在 app ready 前调用
 * - setupPackProtocol()：protocol.handle
 */

const fs = require('node:fs');
const path = require('node:path');
const { resolveDataDir } = require('../../../core/shared-backend/data-paths');
const { resolvePackAssetPath, mimeForPackAsset } = require('../../../core/packages/shared-pack-assets');
const { buildPackCsp } = require('./csp');

const SCHEME = 'petri-pack';
const MAX_BYTES = 10 * 1024 * 1024;

function registerPackSchemePrivileges() {
  const { protocol } = require('electron');
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: false, corsEnabled: false },
    },
  ]);
}

function installedPackRoot(packId) {
  if (typeof packId !== 'string' || !packId) return null;
  try {
    const packRegistry = require('../../../core/shared-backend/pack-registry');
    const record = packRegistry.readInstalledPacks(resolveDataDir())
      .find((pack) => pack && pack.packId === packId);
    if (!record || record.enabled === false || !record.packRoot) return null;
    return record.packRoot;
  } catch {
    return null;
  }
}

function errorResponse(status, message) {
  return new Response(message || 'not found', {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

function setupPackProtocol() {
  const { protocol } = require('electron');
  protocol.handle(SCHEME, (request) => {
    let parsed;
    try {
      parsed = new URL(request.url);
    } catch {
      return errorResponse(400, 'bad url');
    }
    const packId = decodeURIComponent(parsed.hostname || '');
    const packRoot = installedPackRoot(packId);
    if (!packRoot) return errorResponse(404, 'pack not installed or disabled');

    let entry;
    try {
      entry = decodeURIComponent(parsed.pathname || '/');
    } catch {
      return errorResponse(400, 'bad path');
    }
    const resolved = resolvePackAssetPath(packRoot, entry.replace(/^\/+/, ''));
    if (!resolved) return errorResponse(404, 'asset not found');
    if (resolved.size > MAX_BYTES) return errorResponse(413, 'asset exceeds 10MB limit');

    try {
      const bytes = fs.readFileSync(resolved.filePath);
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': mimeForPackAsset(resolved.filePath),
          'Content-Security-Policy': buildPackCsp(),
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      return errorResponse(404, `asset read failed: ${error.code || path.basename(resolved.filePath)}`);
    }
  });
}

module.exports = {
  SCHEME,
  registerPackSchemePrivileges,
  setupPackProtocol,
  installedPackRoot,
};
