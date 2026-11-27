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
const { buildWorkspaceArtifactUrl } = require('../helpers/model3d-artifact-projection');
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

/**
 * item83 第二轮：产物归属当前项目工作区（可见 generated/<kind>/）。
 * 无 projectId 或测试注入 outDir 时保持旧 dataDir + /api/generated/ 兼容层。
 */
function resolveArtifactTarget(ctx, toolId, options = {}) {
  const kind = String(toolId).split('.')[1] || '';
  const legacyUrl = (filePath) => buildGeneratedArtifactUrl(kind, path.basename(filePath));
  if (options.outDir) {
    return { outDir: options.outDir, scope: 'data', kind, projectId: null, urlFor: legacyUrl };
  }
  const projectId = ctx && ctx.projectId ? String(ctx.projectId) : null;
  if (projectId) {
    const rootEntry = options.workspaceRootByProject
      && Object.entries(options.workspaceRootByProject).find(([key]) => key === projectId);
    let root = rootEntry ? rootEntry[1] : undefined;
    if (!root) {
      try {
        const { projectWorkspace } = require('./model3d-tools');
        const ws = projectWorkspace(ctx);
        if (ws && !ws.error && ws.root) root = ws.root;
      } catch { /* 无项目上下文 → 回落 dataDir */ }
    }
    if (root) {
      const relativeDir = `generated/${kind}`;
      return {
        outDir: path.join(root, relativeDir),
        root,
        relativeDir,
        scope: 'workspace',
        kind,
        projectId,
        urlFor: (filePath) => buildWorkspaceArtifactUrl(projectId, path.relative(root, filePath).split(path.sep).join('/')),
      };
    }
  }
  return {
    outDir: path.join(options.dataDir || resolveDataDir(), 'generated', `generate-${kind}`),
    scope: 'data', kind, projectId: null, urlFor: legacyUrl,
  };
}

/** 描述符 path 必须落在 outDir 且 url（若已存在）与来源读面强一致，否则红。 */
function verifyGeneratedDescriptor(descriptor, outDir, kind, urlFor = null) {
  if (!descriptor || typeof descriptor !== 'object') return descriptor;
  const filePath = typeof descriptor.path === 'string' ? descriptor.path : '';
  const root = path.resolve(outDir);
  if (!filePath || !path.resolve(filePath).startsWith(`${root}${path.sep}`)) {
    throw new Error('generated_path_out_of_controlled_dir');
  }
  const expectedUrl = urlFor
    ? urlFor(filePath)
    : buildGeneratedArtifactUrl(kind, path.basename(filePath));
  // url 由上层补；已存在时必须与实际路径一致，缺失不算漂移。
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
  return async function generateHandler(input = {}, ctx = {}) {
    const kind = String(toolId).split('.')[1] || '';
    const target = resolveArtifactTarget(ctx, toolId, options);
    const startedAt = Date.now();
    const recordUsage = options.recordAiUsage || require('../helpers/ai-usage').recordAiUsage;
    const record = (extra = {}) => {
      try {
        recordUsage({
          userId: (ctx && ctx.userId) || null,
          taskId: (ctx && ctx.taskId) || null,
          conversationId: (ctx && ctx.conversationId) || null,
          kind: toolId,
          model: extra.model || null,
          provider: extra.provider || null,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: Date.now() - startedAt,
          costStatus: 'unknown', // 生成模型无定价，不调 estimateCostCNY，不伪造费用
          errorCode: extra.errorCode || null,
        });
      } catch { /* 记账失败不影响产物交付 */ }
    };

    // item83 第二轮：params.mode='local' 必须走本地近似，绝不打 Ark。
    if (toolId === 'generate.model3d' && input.params && input.params.mode === 'local') {
      if (typeof options.localRecipeRunner !== 'function') throw new Error('local_recipe_unavailable');
      const local = await options.localRecipeRunner({
        recipeId: input.recipeId || 'box-enclosure',
        params: input.params,
        dryRun: false,
        render: false,
        annotation: true,
        workspaceRoot: target.root || null,
      });
      if (!local || local.ok === false) throw new Error(`local_recipe_failed: ${(local && local.error) || 'unknown'}`);
      const rel = (local.written && local.written.path) || `generated/model3d/${(local.recipe && local.recipe.id) || 'local'}.scene3d.json`;
      const filePath = path.isAbsolute(rel) ? rel : path.join(target.root || options.dataDir || resolveDataDir(), rel);
      const descriptor = {
        path: filePath,
        sha256: fs.existsSync(filePath) ? sha256File(filePath) : null,
        mime: 'application/json',
        source: local.source || { provider: 'local', mode: 'parametric-recipe', status: 'approximation', synthetic: true, label: '本地近似非 AI 生成' },
        scope: target.scope,
        projectId: target.projectId,
        url: target.urlFor(filePath),
      };
      record({ model: 'parametric-recipe', provider: 'local' });
      return descriptor;
    }

    // HTML 是本地静态产物（无云 provider），UTF-8 写入当前项目工作区。
    if (toolId === 'generate.html') {
      const content = typeof input.content === 'string' ? input.content : '';
      if (!content) throw new Error('html_content_required');
      const filename = String(input.filename || 'artifact.html').split(/[\\/]/).pop() || 'artifact.html';
      fs.mkdirSync(target.outDir, { recursive: true });
      const filePath = path.join(target.outDir, filename);
      fs.writeFileSync(filePath, content, { encoding: 'utf8' });
      record({ model: 'html-static', provider: 'local' });
      return {
        path: filePath,
        sha256: sha256File(filePath),
        mime: 'text/html',
        source: { provider: 'local', model: 'html-static', kind: 'generate.html', filename },
        scope: target.scope,
        projectId: target.projectId,
        url: target.urlFor(filePath),
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

    const deps = {
      apiKey,
      fetch: options.fetch || globalThis.fetch,
      outDir: target.outDir,
      ...(options.deps || {}),
    };
    const resolvedInput = { ...input };
    if (toolId === 'generate.model3d' && input.referenceArtifactId && !input.referenceImage) {
      resolvedInput.referenceImage = await resolveReferenceImage(input, { dataDir: options.dataDir });
    }
    let rawResult;
    try {
      rawResult = await fn(resolvedInput, deps);
    } catch (error) {
      record({ errorCode: (error && error.message ? error.message : String(error)).split(':')[0] });
      throw error;
    }
    // 路径强一致校验 + 补读面 url（workspace 或 legacy 兼容层）。
    const checked = Array.isArray(rawResult)
      ? rawResult.map((d) => verifyGeneratedDescriptor(d, target.outDir, kind, target.urlFor))
      : verifyGeneratedDescriptor(rawResult, target.outDir, kind, target.urlFor);
    const withUrl = (descriptor) => {
      if (!descriptor || typeof descriptor !== 'object' || typeof descriptor.path !== 'string') return descriptor;
      return {
        ...descriptor,
        scope: target.scope,
        projectId: target.projectId,
        url: descriptor.url || target.urlFor(descriptor.path),
      };
    };
    const final = Array.isArray(checked) ? checked.map(withUrl) : withUrl(checked);
    const first = Array.isArray(final) ? final[0] : final;
    record({
      model: (first && first.source && first.source.model) || null,
      provider: (first && first.source && first.source.provider) || null,
    });
    return final;
  };
}

module.exports = { createGenerateHandler, resolveBuiltInPackRoot, readToolRegistry, resolveReferenceImage, verifyGeneratedDescriptor, resolveArtifactTarget };
