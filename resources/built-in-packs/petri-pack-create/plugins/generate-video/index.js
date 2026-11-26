/**
 * generate.video — P1 Seedance provider adapter（provider 细节留在本包，内核零硬编码）。
 *
 * 创作宪法：异步任务（创建→轮询→取消）→ mp4 artifact 描述符（path/sha256/mime/source）。
 * 凭据 env ARK_API_KEY / PETRI_CREDENTIAL_ARK_SEEDANCE；不落明文、不写日志。
 * 薄包纪律：纯 HTTP + Node 内建（crypto/fs/path），零本地模型、零重资产。
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const API_BASE = process.env.ARK_API_BASE || 'https://ark.cn-beijing.volces.com/api/v3';
const DEFAULT_MODEL = process.env.ARK_SEEDANCE_MODEL || 'doubao-seedance-2-0-mini-260615';
const DEFAULT_MAX_POLLS = 300;
const DEFAULT_POLL_INTERVAL_MS = 1000;

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function resolveApiKey() {
  if (process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  return process.env.PETRI_CREDENTIAL_ARK_SEEDANCE || null;
}

function headers(apiKey) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
}

async function createTask({ prompt, params, referenceArtifactId }, opts) {
  const resp = await opts.fetch(`${API_BASE}/contents/generations/tasks`, {
    method: 'POST',
    headers: headers(opts.apiKey),
    // Ark 官方结构：prompt 在 content:[{type:'text'}]，非顶层字段（2026-11-26 自调用 400 实证）
    body: JSON.stringify({
      model: opts.model || DEFAULT_MODEL,
      content: [{ type: 'text', text: prompt }],
      ...(params && typeof params === 'object' ? params : {}),
      ...(referenceArtifactId ? { image: referenceArtifactId } : {}),
    }),
  });
  if (!resp.ok) throw new Error(`seedance_http_${resp.status}`);
  const payload = await resp.json();
  if (!payload || !payload.id) throw new Error('seedance_task_missing');
  return payload.id;
}

async function pollTask(taskId, opts) {
  const maxPolls = opts.maxPolls || DEFAULT_MAX_POLLS;
  const interval = opts.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS;
  for (let i = 0; i < maxPolls; i += 1) {
    const resp = await opts.fetch(`${API_BASE}/contents/generations/tasks/${encodeURIComponent(taskId)}`, {
      method: 'GET', headers: headers(opts.apiKey),
    });
    if (!resp.ok) throw new Error(`seedance_http_${resp.status}`);
    const payload = await resp.json();
    if (payload.status === 'succeeded') return payload;
    if (payload.status === 'failed' || payload.status === 'cancelled') throw new Error('seedance_task_failed');
    await opts.sleep(interval);
  }
  throw new Error('seedance_timeout');
}

async function generateVideo(input = {}, deps = {}) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) throw new Error('prompt_required');
  const apiKey = deps.apiKey || resolveApiKey();
  if (!apiKey) throw new Error('ark_credential_missing');
  const opts = {
    fetch: deps.fetch || globalThis.fetch,
    apiKey, model: deps.model, maxPolls: deps.maxPolls,
    pollIntervalMs: deps.pollIntervalMs, sleep: deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms))),
  };
  const taskId = await createTask({ prompt, params: input.params, referenceArtifactId: input.referenceArtifactId }, opts);
  const result = await pollTask(taskId, opts);

  const outDir = deps.outDir || path.join(process.cwd(), 'create-output');
  fs.mkdirSync(outDir, { recursive: true });
  const filePath = path.join(outDir, `video-${taskId}-${Date.now()}.mp4`);
  // Ark 实际产物 = content.video_url（MP4）——立即下载转存（URL 24h 失效）。
  const url = (result.content && result.content.video_url) || result.video_url || null;
  if (!url) throw new Error('seedance_empty_output');
  const downloaded = await opts.fetch(url);
  if (!downloaded.ok) throw new Error(`seedance_download_http_${downloaded.status}`);
  const buf = Buffer.from(await downloaded.arrayBuffer());
  if (!buf.length) throw new Error('seedance_empty_output');
  fs.writeFileSync(filePath, buf);

  return {
    path: filePath,
    sha256: sha256File(filePath),
    mime: 'video/mp4',
    source: {
      provider: 'seedance', model: opts.model || DEFAULT_MODEL, prompt,
      taskId, status: result.status, videoUrl: result.video_url || null,
      // 计费观测元数据：ai_usage 同模式（model/provider/taskId），由宿主记账
      usage: { kind: 'generate.video', provider: 'seedance', model: opts.model || DEFAULT_MODEL, taskId },
    },
  };
}

async function cancelVideoTask(taskId, deps = {}) {
  if (!taskId) return { ok: false, error: 'task_id_required' };
  const apiKey = deps.apiKey || resolveApiKey();
  if (!apiKey) throw new Error('ark_credential_missing');
  const fetchImpl = deps.fetch || globalThis.fetch;
  const resp = await fetchImpl(`${API_BASE}/contents/generations/tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: 'POST', headers: headers(apiKey),
  });
  if (!resp.ok) throw new Error(`seedance_http_${resp.status}`);
  return { ok: true, taskId };
}

module.exports = { generateVideo, cancelVideoTask, sha256File, resolveApiKey };
