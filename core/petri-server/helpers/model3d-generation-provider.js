'use strict';

/**
 * helpers/model3d-generation-provider.js — BLOCK-322 P5-02 外部文/图生 3D 接线。
 *
 * 默认 provider=none（零出站）；只有显式配置 Tripo key 或测试用 mock 才可用。
 * 生成结果仍走 P5-01 资产链（sha256 + provenance），不产生第二份场景真值。
 * 隐私边界：prompt（以及未来的图片）会发往外部服务；未配置/未同意不发送。
 */

const crypto = require('node:crypto');

const PROVIDERS = Object.freeze(['none', 'mock', 'tripo']);
const DEFAULT_BASE_URL = 'https://openapi.tripo3d.com/v3';
const DEFAULT_MODEL = 'v3.1-20260211';
const DEFAULT_TEXTURE_QUALITY = 'detailed';
const MIN_PROMPT = 3;
const MAX_PROMPT = 1024;
const MAX_GLB_BYTES = 128 * 1024 * 1024;
const POLL_INTERVAL_MS = 3000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DOWNLOAD_TIMEOUT_MS = 120 * 1000;

function configuredProvider() {
  const raw = String(process.env.PETRI_MODEL3D_GENERATION_PROVIDER || 'none').trim().toLowerCase();
  return PROVIDERS.includes(raw) ? raw : 'none';
}

function configuredBaseUrl() {
  return String(process.env.PETRI_MODEL3D_GENERATION_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function configuredModel() {
  return String(process.env.PETRI_MODEL3D_GENERATION_MODEL || DEFAULT_MODEL).trim();
}

function configuredTextureQuality() {
  const raw = String(process.env.PETRI_MODEL3D_GENERATION_TEXTURE_QUALITY || DEFAULT_TEXTURE_QUALITY).trim().toLowerCase();
  return ['fast', 'standard', 'detailed', 'extreme'].includes(raw) ? raw : DEFAULT_TEXTURE_QUALITY;
}

function resolveApiKey() {
  const direct = process.env.TRIPO_API_KEY || process.env.PETRI_TRIPO_API_KEY || process.env.PETRI_MODEL3D_GENERATION_API_KEY;
  if (direct && String(direct).trim()) return String(direct).trim();
  try {
    // 懒加载：不把 ai-settings 的初始化副作用带进纯工具测试。
    const aiSettings = require('./ai-settings');
    return String(aiSettings.getApiKey('tripo') || '').trim();
  } catch {
    return '';
  }
}

function privacyNotice() {
  return {
    external: true,
    prompt: true,
    image: false,
    note: 'Text prompt is sent to Tripo (external service). Model URLs expire quickly; the generated GLB is stored locally with sha256/provenance.',
    pricingUrl: 'https://www.tripo3d.ai/pricing',
    costNote: 'Per-generation billing depends on model/texture quality; check the provider pricing page before generating.',
  };
}

function probeGenerationProvider() {
  const provider = configuredProvider();
  if (provider === 'none') {
    return {
      status: 'unavailable',
      reason: 'generation_provider_none',
      provider,
      model: null,
      privacy: privacyNotice(),
      message: '外部 3D 生成服务未启用。设置 PETRI_MODEL3D_GENERATION_PROVIDER=tripo 并提供 TRIPO_API_KEY 后启用。',
    };
  }
  if (provider === 'mock') {
    return {
      status: 'ready',
      reason: 'generation_provider_mock',
      provider,
      model: 'mock',
      privacy: { ...privacyNotice(), external: false, note: 'Mock provider for local verification; no network request is made.' },
      message: 'mock 生成器（仅测试/演示，不会调用外部服务）。',
    };
  }
  const apiKey = resolveApiKey();
  if (!apiKey) {
    return {
      status: 'unavailable',
      reason: 'generation_key_missing',
      provider,
      model: configuredModel(),
      privacy: privacyNotice(),
      message: 'Tripo key 未配置：设置 TRIPO_API_KEY（或凭据存储 tripo）后再生成。',
    };
  }
  return {
    status: 'ready',
    reason: null,
    provider,
    model: configuredModel(),
    baseUrl: configuredBaseUrl(),
    privacy: privacyNotice(),
    message: 'Tripo 文本生成 3D 已配置；调用会产生外部费用。',
  };
}

function promptHash(prompt) {
  return crypto.createHash('sha256').update(String(prompt)).digest('hex');
}

function validatePrompt(prompt) {
  const text = String(prompt || '').trim();
  if (text.length < MIN_PROMPT) return { ok: false, error: 'generation_prompt_too_short' };
  if (text.length > MAX_PROMPT) return { ok: false, error: 'generation_prompt_too_long' };
  return { ok: true, prompt: text };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const abort = () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      };
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
  });
}

async function fetchJson(url, options, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  const data = await response.json().catch(() => null);
  return { response, data };
}

function taskIdFromSubmit(data) {
  return data?.data?.task_id || data?.task_id || data?.output?.task_id || null;
}

function taskStatus(data) {
  return String(data?.status || data?.task_status || data?.output?.task_status || '').toLowerCase();
}

function taskModelUrl(data) {
  const output = data?.output || data?.data || {};
  return output.pbr_model_url || output.model_url || output.pbr_model || output.model || output.base_model_url || null;
}

function trustedDownloadUrl(value, baseUrl) {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return null;
    const base = new URL(baseUrl);
    const hosts = new Set([base.hostname, 'tripo3d.com', 'www.tripo3d.com', 'tripo3d.ai', 'www.tripo3d.ai']);
    if (![...hosts].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) return null;
    return url;
  } catch {
    return null;
  }
}

async function downloadGlb(url, baseUrl, signal, fetchImpl = fetch) {
  const trusted = trustedDownloadUrl(url, baseUrl);
  if (!trusted) return { ok: false, error: 'generation_url_untrusted' };
  const response = await fetchImpl(trusted, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) return { ok: false, error: 'generation_download_failed', status: response.status };
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_GLB_BYTES) return { ok: false, error: 'generation_too_large', bytes: length };
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_GLB_BYTES) return { ok: false, error: 'generation_too_large', bytes: buffer.length };
  if (buffer.subarray(0, 4).toString('ascii') !== 'glTF') return { ok: false, error: 'generation_invalid_glb' };
  return { ok: true, glb: buffer };
}

async function generateTripo({ prompt, signal, fetchImpl = fetch } = {}) {
  const provider = probeGenerationProvider();
  if (provider.status !== 'ready') return { ok: false, error: provider.reason || 'generation_not_configured', provider };
  const baseUrl = configuredBaseUrl();
  const apiKey = resolveApiKey();
  const model = configuredModel();
  const body = {
    prompt,
    model,
    texture: true,
    pbr: true,
    texture_quality: configuredTextureQuality(),
  };
  let submitted;
  try {
    submitted = await fetchJson(`${baseUrl}/generation/text-to-model`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    }, fetchImpl);
  } catch (error) {
    return { ok: false, error: 'generation_submit_failed', message: String(error && error.message ? error.message : error) };
  }
  const taskId = taskIdFromSubmit(submitted.data);
  if (!submitted.response.ok || !taskId) {
    const message = submitted.data?.message || submitted.data?.error || `HTTP ${submitted.response.status}`;
    return { ok: false, error: 'generation_submit_failed', status: submitted.response.status, message: String(message).slice(0, 500) };
  }
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let lastTask = null;
  while (Date.now() < deadline) {
    let polled;
    try {
      polled = await fetchJson(`${baseUrl}/tasks/${encodeURIComponent(taskId)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
      }, fetchImpl);
    } catch (error) {
      return { ok: false, error: 'generation_poll_failed', taskId, message: String(error && error.message ? error.message : error) };
    }
    if (!polled.response.ok) {
      return { ok: false, error: 'generation_poll_failed', taskId, status: polled.response.status };
    }
    lastTask = polled.data;
    const status = taskStatus(polled.data);
    if (status === 'success') {
      const url = taskModelUrl(polled.data);
      if (!url) return { ok: false, error: 'generation_no_model_url', taskId };
      const downloaded = await downloadGlb(url, baseUrl, signal, fetchImpl);
      if (!downloaded.ok) return { ...downloaded, taskId };
      return {
        ok: true,
        glb: downloaded.glb,
        provider: 'tripo',
        model,
        taskId,
        promptHash: promptHash(prompt),
        usage: polled.data?.usage || polled.data?.output?.usage || null,
      };
    }
    if (['failed', 'cancelled', 'banned', 'expired', 'unknown'].includes(status)) {
      return {
        ok: false,
        error: 'generation_failed',
        taskId,
        status,
        message: String(polled.data?.message || polled.data?.output?.message || status).slice(0, 500),
      };
    }
    await sleep(POLL_INTERVAL_MS, signal);
  }
  return { ok: false, error: 'generation_timeout', taskId, lastStatus: taskStatus(lastTask) };
}

async function generateMock() {
  const { OcctKernel } = await import('occt-wasm');
  const kernel = await OcctKernel.init();
  try {
    const box = kernel.makeBox(20, 20, 20);
    const doc = kernel.createXCAFDocument();
    doc.addShape(box, { name: 'mock-generated' });
    const glb = doc.exportGLTF();
    doc.close();
    return { ok: true, glb: Buffer.from(glb), provider: 'mock', model: 'mock', taskId: null, promptHash: null, usage: null };
  } finally {
    try { kernel[Symbol.dispose](); } catch { /* disposed */ }
  }
}

async function generateModel({ prompt, signal, fetchImpl } = {}) {
  const checked = validatePrompt(prompt);
  if (!checked.ok) return checked;
  const probe = probeGenerationProvider();
  if (probe.status !== 'ready') return { ok: false, error: probe.reason || 'generation_not_configured', provider: probe };
  if (probe.provider === 'mock') return generateMock();
  if (probe.provider === 'tripo') return generateTripo({ prompt: checked.prompt, signal, fetchImpl });
  return { ok: false, error: 'generation_provider_invalid' };
}

module.exports = {
  PROVIDERS,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_TEXTURE_QUALITY,
  MIN_PROMPT,
  MAX_PROMPT,
  MAX_GLB_BYTES,
  configuredProvider,
  configuredBaseUrl,
  configuredModel,
  resolveApiKey,
  privacyNotice,
  probeGenerationProvider,
  promptHash,
  generateModel,
};
