/**
 * generate.* 通用 handler（owner 裁决「包应内置」）。
 *
 * 内核只做provider 无关的派发：从内置包 registry 读 entry/exportName/credentialProvider，
 * 动态 require 包内插件函数，注入凭据与产物目录后原样返回插件的 artifact 描述符。
 * 本文件零 provider 字面量——provider 名/模型 ID 只存在于内置包配置与插件内。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_PACK_DIR = path.resolve(__dirname, '..', '..', '..', 'resources', 'built-in-packs', 'petri-pack-create');

function resolveBuiltInPackRoot() {
  return process.env.PETRI_BUILT_IN_PACKS_DIR || DEFAULT_PACK_DIR;
}

function readToolRegistry(packRoot) {
  const file = path.join(packRoot, 'registry', 'generate-tools.json');
  if (!fs.existsSync(file)) throw new Error('generate_registry_missing');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!parsed || !Array.isArray(parsed.tools)) throw new Error('generate_registry_invalid');
  return parsed;
}

function resolveCredential(provider, options) {
  if (Object.prototype.hasOwnProperty.call(options, 'apiKey')) return options.apiKey;
  const { createCredentialStore } = require('../helpers/credential-store');
  const { resolveDataDir } = require('../../shared-backend/data-paths');
  return createCredentialStore({ settingsDir: resolveDataDir() }).get(provider);
}

/**
 * @param {string} toolId generate.image / generate.video / generate.model3d
 * @param {object} [options] 测试/运维注入：packRoot/apiKey/fetch/outDir/deps
 */
function createGenerateHandler(toolId, options = {}) {
  return async function generateHandler(input = {}) {
    const packRoot = path.resolve(options.packRoot || resolveBuiltInPackRoot());
    const entry = readToolRegistry(packRoot).tools.find((t) => t && t.id === toolId);
    if (!entry) throw new Error('generate_tool_not_found');

    const entryPath = path.resolve(packRoot, String(entry.entry || ''));
    if (!entryPath.startsWith(`${packRoot}${path.sep}`)) throw new Error('generate_entry_out_of_bounds');
    if (!fs.existsSync(entryPath)) throw new Error('generate_entry_missing');

    const fn = require(entryPath)[entry.exportName];
    if (typeof fn !== 'function') throw new Error('generate_export_missing');

    const apiKey = resolveCredential(entry.credentialProvider, options);
    if (!apiKey) throw new Error('generate_credential_missing');

    const outDir = options.outDir || path.join(
      require('../../shared-backend/data-paths').resolveDataDir(), 'generated', toolId.replace('.', '-'),
    );
    const deps = {
      apiKey,
      fetch: options.fetch || globalThis.fetch,
      outDir,
      ...(options.deps || {}),
    };
    return fn(input, deps);
  };
}

module.exports = { createGenerateHandler, resolveBuiltInPackRoot, readToolRegistry };
