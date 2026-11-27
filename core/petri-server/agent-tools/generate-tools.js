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
const crypto = require('node:crypto');
const { buildGeneratedArtifactUrl } = require('../routes/generated-file');
const { resolveDataDir } = require('../../shared-backend/data-paths');

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

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * item84：把 referenceArtifactId 解析成插件要的 data URL（裸 sha256 指向本会话 generate.image
 * 产物）。解析不到一律 fail-closed，绝不静默退化成文生——那正是 owner 会话的误诊根因。
 */
async function resolveReferenceImage(input = {}, options = {}) {
  if (typeof input.referenceImage === 'string' && input.referenceImage) return input.referenceImage;
  const ref = input.referenceArtifactId;
  if (typeof ref !== 'string' || !ref) return null;
  if (/^(data:|https?:|file:)/i.test(ref)) return ref;
  const dataDir = options.dataDir || resolveDataDir();
  const imageDir = path.join(dataDir, 'generated', 'generate-image');
  let matches = [];
  try {
    matches = fs.readdirSync(imageDir).map((name) => path.join(imageDir, name)).filter((filePath) => {
      try {
        return fs.statSync(filePath).isFile() && sha256File(filePath) === ref;
      } catch { return false; }
    });
  } catch { /* 目录不存在按未解析处理 */ }
  if (!matches.length) {
    throw new Error(`reference_artifact_unresolved: referenceArtifactId ${ref} 无法解析为本地图片；请传 generate.image 返回的 url/path`);
  }
  if (matches.length > 1) throw new Error(`artifact_identity_ambiguous: referenceArtifactId ${ref} 命中多个产物`);
  const { imageDataUrlFromBuffer } = require('./vision-image-io');
  const encoded = imageDataUrlFromBuffer(fs.readFileSync(matches[0]), matches[0], path.basename(matches[0]));
  if (encoded.error) throw new Error(`reference_artifact_unresolved: ${encoded.error}`);
  return encoded.dataUrl;
}

/** item83 返工：描述符 path 必须落在受控 outDir 且 url 与 basename 强一致，否则红。 */
function verifyGeneratedDescriptor(descriptor, outDir, kind) {
  if (!descriptor || typeof descriptor !== 'object') return descriptor;
  const filePath = typeof descriptor.path === 'string' ? descriptor.path : '';
  const root = path.resolve(outDir);
  if (!filePath || !path.resolve(filePath).startsWith(`${root}${path.sep}`)) {
    throw new Error('generated_path_out_of_controlled_dir');
  }
  const expectedUrl = buildGeneratedArtifactUrl(kind, path.basename(filePath));
  // url 由上层 withUrl 补；已存在时必须与实际 basename 一致，缺失不算漂移。
  if (expectedUrl && typeof descriptor.url === 'string' && descriptor.url !== expectedUrl) {
    throw new Error('generated_descriptor_url_mismatch');
  }
  return descriptor;
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
    // item83 返工：HTML 是本地静态产物（无云 provider），统一走受控目录 + UTF-8 写入。
    if (toolId === 'generate.html') {
      const content = typeof input.content === 'string' ? input.content : '';
      if (!content) throw new Error('html_content_required');
      const filename = String(input.filename || 'artifact.html').split(/[\\/]/).pop() || 'artifact.html';
      const htmlDir = options.outDir || path.join(options.dataDir || resolveDataDir(), 'generated', 'generate-html');
      fs.mkdirSync(htmlDir, { recursive: true });
      const filePath = path.join(htmlDir, filename);
      fs.writeFileSync(filePath, content, { encoding: 'utf8' });
      return {
        path: filePath,
        sha256: sha256File(filePath),
        mime: 'text/html',
        source: { provider: 'local', model: 'html-static', kind: 'generate.html', filename },
        url: buildGeneratedArtifactUrl('html', filename),
      };
    }
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
    const resolvedInput = { ...input };
    if (toolId === 'generate.model3d' && input.referenceArtifactId && !input.referenceImage) {
      resolvedInput.referenceImage = await resolveReferenceImage(input, { dataDir: options.dataDir });
    }
    const rawResult = await fn(resolvedInput, deps);
    // item83 返工：先校验落盘路径强一致，再补受控读面 url。
    const kind = String(toolId).split('.')[1] || '';
    const checked = Array.isArray(rawResult)
      ? rawResult.map((d) => verifyGeneratedDescriptor(d, outDir, kind))
      : verifyGeneratedDescriptor(rawResult, outDir, kind);
    const withUrl = (descriptor) => {
      if (!descriptor || typeof descriptor !== 'object' || typeof descriptor.path !== 'string') return descriptor;
      const url = buildGeneratedArtifactUrl(kind, path.basename(descriptor.path));
      return url ? { ...descriptor, url } : descriptor;
    };
    return Array.isArray(checked) ? checked.map(withUrl) : withUrl(checked);
  };
}

module.exports = { createGenerateHandler, resolveBuiltInPackRoot, readToolRegistry, resolveReferenceImage, verifyGeneratedDescriptor };
