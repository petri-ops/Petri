/**
 * generate.model3d — Ark 3D 双模式 adapter（provider 细节留在本包，内核零硬编码）。
 *
 * 模式路由（P2a 图生 + P2b 文生，同插件双模式）：
 *   - 有 referenceImage → Seed3D 图生3D（doubao-seed3d-2-0-260328）
 *   - 无 referenceImage → Hyper3d-Gen2 文生3D（hyper3d-gen2-260112，影眸 Rodin 方舟托管）
 * 两者共用 Ark 统一异步协议：创建任务 → 轮询 → content.file_url 转存 + sha256。
 * 官方契约核真：volcengine.com/docs/ark/shadoweye-create-3d-generation-task-api（2026-11-26）。
 * 薄包纪律：纯 HTTP + Node 内建（crypto/fs/path），零本地模型/重资产。
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const API_BASE = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_IMAGE_MODEL = process.env.ARK_SEED3D_MODEL || 'doubao-seed3d-2-0-260328';
const DEFAULT_TEXT_MODEL = process.env.ARK_HYPER3D_MODEL || 'hyper3d-gen2-260112';
const DEFAULT_MAX_POLLS = 300;
const DEFAULT_POLL_INTERVAL_MS = 1000;

const MODE_CONFIG = {
  image: { tag: 'seed3d', provider: 'seed3d', defaultModel: DEFAULT_IMAGE_MODEL },
  text: { tag: 'hyper3d', provider: 'hyper3d-gen2', defaultModel: DEFAULT_TEXT_MODEL },
};

function detectMode(input) {
  return input && input.referenceImage ? 'image' : 'text';
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveApiKey() {
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  return process.env.PETRI_CREDENTIAL_ARK_SEED3D
    || process.env.PETRI_CREDENTIAL_ARK_HYPER3D
    || null;
}

function headers(apiKey) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
}

function buildContent(mode, { prompt, referenceImage, params }) {
  const p = params && typeof params === 'object' ? params : {};
  const flags = [];
  if (mode === 'image') {
    if (!referenceImage) throw new Error('reference_image_required');
    // Seed3D 规格参数走 --subdivisionlevel / --fileformat / --face_count
    if (p.subdivision) flags.push(`--subdivisionlevel ${p.subdivision}`);
    if (p.fileformat) flags.push(`--fileformat ${p.fileformat}`);
    else flags.push('--fileformat glb');
    if (p.faces) flags.push(`--face_count ${p.faces}`);
    const content = [{ type: 'text', text: `${prompt} ${flags.join(' ')}`.trim() }];
    content.push({ type: 'image_url', image_url: { url: referenceImage } });
    return content;
  }
  // Hyper3d-Gen2 文生3D：规格参数经 content.text 以 --flag 传入（官方文档形态）
  if (p.meshMode) flags.push(`--mesh_mode ${p.meshMode}`);
  if (p.hdTexture !== undefined) flags.push(`--hd_texture ${p.hdTexture}`);
  if (p.material) flags.push(`--material ${p.material}`);
  if (p.addons) flags.push(`--addons ${p.addons}`);
  if (p.qualityOverride !== undefined) flags.push(`--quality_override ${p.qualityOverride}`);
  if (p.bboxCondition) flags.push(`--bbox_condition ${p.bboxCondition}`);
  if (p.alpha !== undefined) flags.push(`--use_original_alpha ${p.alpha}`);
  if (p.tAPose !== undefined) flags.push(`--TAPose ${p.tAPose}`);
  return [{ type: 'text', text: `${prompt} ${flags.join(' ')}`.trim() }];
}

async function createTask(input, opts) {
  const body = { model: opts.model, content: buildContent(opts.mode, input) };
  if (opts.mode === 'text' && input.params && input.params.seed !== undefined) {
    body.seed = input.params.seed;
  }
  const resp = await opts.fetch(`${API_BASE}/contents/generations/tasks`, {
    method: 'POST',
    headers: headers(opts.apiKey),
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw arkHttpError(resp.status, opts.tag);
  const payload = await resp.json();
  if (!payload || !payload.id) throw new Error(`${opts.tag}_task_missing`);
  return payload.id;
}

/** item83 第二轮：稳定错误码——401/403 可分辨未开通/未订阅，避免只剩 hyper3d_task_failed 文案。 */
function arkHttpError(status, tag) {
  if (status === 401) return new Error('generate_ark_unauthorized: Ark 凭据未授权或已失效');
  if (status === 403) return new Error('generate_ark_not_subscribed: 模型未开通/未订阅，请在方舟控制台确认');
  return new Error(`generate_ark_task_failed: ${tag}_http_${status} 模型未开通/不可用或任务失败`);
}

async function pollTask(taskId, opts) {
  const maxPolls = opts.maxPolls || DEFAULT_MAX_POLLS;
  const interval = opts.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  for (let i = 0; i < maxPolls; i += 1) {
    const resp = await opts.fetch(`${API_BASE}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET', headers: headers(opts.apiKey),
    });
    if (!resp.ok) throw arkHttpError(resp.status, opts.tag);
    const payload = await resp.json();
    if (payload.status === 'succeeded') return payload;
    if (payload.status === 'failed' || payload.status === 'cancelled') {
      throw new Error('generate_ark_task_failed: 模型未开通/不可用或任务失败；图生/文生共用同一把 Ark 凭据，无需独立 Hyper3D key');
    }
    await opts.sleep(interval);
  }
  throw new Error(`${opts.tag}_timeout`);
}

async function generateModel3D(input = {}, deps = {}) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) throw new Error('prompt_required');
  const apiKey = deps.apiKey || resolveApiKey();
  if (!apiKey) throw new Error('ark_credential_missing');

  const mode = detectMode(input);
  const cfg = MODE_CONFIG[mode];
  const model = deps.model || cfg.defaultModel;
  const opts = {
    fetch: deps.fetch || globalThis.fetch, apiKey, mode, tag: cfg.tag, model,
    maxPolls: deps.maxPolls, pollIntervalMs: deps.pollIntervalMs,
    sleep: deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
  };

  const taskId = await createTask({ prompt, referenceImage: input.referenceImage, params: input.params }, opts);
  const result = await pollTask(taskId, opts);

  // 立即转存：产物链接短期有效（Seed3D 文档 24h / Hyper3d 7 天），落盘 + sha256 后再交付。
  const outDir = deps.outDir || path.join(process.cwd(), 'create-output');
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `model-${taskId}-${Date.now()}.glb`);
  // Ark 3D 产物 = content.file_url（ZIP：glb + 贴图），必须立即转存，不直接透传厂商 URL。
  const url = (result.content && result.content.file_url) || result.download_url || null;
  if (!url) throw new Error(`${opts.tag}_empty_output`);
  const downloaded = await opts.fetch(url);
  if (!downloaded.ok) throw new Error(`${opts.tag}_download_http_${downloaded.status}`);
  const buf = Buffer.from(await downloaded.arrayBuffer());
  if (!buf.length) throw new Error(`${opts.tag}_empty_output`);
  fs.writeFileSync(filePath, buf);
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b; // PK
  const finalPath = isZip && !filePath.endsWith('.zip') ? filePath.replace(/\.glb$/, '.zip') : filePath;
  if (finalPath !== filePath) fs.renameSync(filePath, finalPath);

  return {
    path: finalPath,
    sha256: sha256File(finalPath),
    mime: finalPath.endsWith('.zip') ? 'application/zip' : 'model/gltf-binary',
    source: {
      provider: cfg.provider, model, prompt, mode,
      kind: 'generate.model3d', taskId, status: result.status, archive: finalPath.endsWith('.zip'),
      reference: input.referenceArtifactId || null,
      usage: { kind: 'generate.model3d', provider: cfg.provider, model, taskId },
    },
  };
}

async function cancelModel3DTask(taskId, deps = {}) {
  if (!taskId) return { ok: false, error: 'task_id_required' };
  const apiKey = deps.apiKey || resolveApiKey();
  if (!apiKey) throw new Error('ark_credential_missing');
  const tag = deps.mode === 'text' ? MODE_CONFIG.text.tag : MODE_CONFIG.image.tag;
  const resp = await (deps.fetch || globalThis.fetch)(
    `${API_BASE}/contents/generations/tasks/${encodeURIComponent(taskId)}/cancel`,
    { method: 'POST', headers: headers(apiKey) },
  );
  if (!resp.ok) throw new Error(`${tag}_http_${resp.status}`);
  return { ok: true, taskId };
}

module.exports = { generateModel3D, cancelModel3DTask, sha256File, resolveApiKey, detectMode, buildContent };
