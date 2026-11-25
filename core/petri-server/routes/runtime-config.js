'use strict';

/**
 * routes/runtime-config.js — 网络代理与运行时策略 REST 面（BLOCK-202 W3）。
 *
 *  GET  /api/network        → 已配置/已应用/生效 NO_PROXY/是否需重启
 *  PUT  /api/network        → 写代理四项（未知键/非法形状 400 + diagnostics；**需重启生效**）
 *  GET  /api/runtime-policy → 审批默认档位/并发/深度/工具黑名单（含 env 遮蔽报告）
 *  PUT  /api/runtime-policy → 写策略（审批与黑名单即时生效；并发/深度下一轮派生生效）
 *  GET  /api/web-access    → 联网检索授权/预算快照（BLOCK-247 Q2b；默认关）
 *  PUT  /api/web-access    → 写联网授权（**即时生效**，无 restartRequired 语义）
 *  GET  /api/ocr-access    → 扫描件 OCR 授权快照（BLOCK-454 P3；默认关）
 *  PUT  /api/ocr-access    → 写 OCR 授权（**即时生效**；key 走凭据族不在本面）
 *  GET  /api/speech-access → 语音（ASR/TTS）授权快照（BLOCK-454 P6；默认关）
 *  PUT  /api/speech-access → 写语音授权（**即时生效**；key 走凭据族不在本面）
 *
 *  GET/POST/DELETE /api/speech/local-models[:/id/download] → BLOCK-519 本地 ASR 模型管理
 * 拒绝形状与 keymap/generation/config-transfer 同构：400 + 结构化 diagnostics。
 * 代理与 CA 只在进程启动时被 Node 读取，因此 PUT 只做持久化与「需重启」标记，不谎称已生效。
 */

const express = require('express');
const network = require('../helpers/network-config');
const runtime = require('../helpers/runtime-policy');
// BLOCK-247（Q2b）— 联网检索授权面（默认关；即时生效，无"需重启"语义）
const webSearch = require('../helpers/web-search-config');
// BLOCK-454（P3）— 扫描件 OCR 授权面（默认关；即时生效；key 走凭据族）
const ocrConfig = require('../helpers/ocr-config');
// BLOCK-454（P6）— 语音（ASR/TTS）授权面（默认关；即时生效；key 走凭据族）
const speechConfig = require('../helpers/speech-config');
const localAsrModel = require('../helpers/local-asr-model');

function sendRejection(res, error) {
  if (error && error.message === 'config_value_rejected') {
    return res.status(400).json({ status: 'error', error: error.message, diagnostics: error.diagnostics || [] });
  }
  return res.status(500).json({ status: 'error', error: error.message });
}

module.exports = function mountRuntimeConfig(app) {
  app.get('/api/network', (req, res) => {
    try {
      return res.json({ status: 'ok', network: network.getNetworkSnapshot() });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.put('/api/network', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const snapshot = network.saveNetworkConfig(req.body || {});
      // 写侧只落盘；生效要重启后端（Node 只在启动时读 proxy/CA env）
      return res.json({ status: 'ok', network: snapshot, restartRequired: true });
    } catch (error) {
      return sendRejection(res, error);
    }
  });

  app.get('/api/runtime-policy', (req, res) => {
    try {
      return res.json({ status: 'ok', runtime: runtime.getRuntimeSnapshot() });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.put('/api/runtime-policy', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const snapshot = runtime.saveRuntimePolicy(req.body || {});
      return res.json({ status: 'ok', runtime: snapshot });
    } catch (error) {
      return sendRejection(res, error);
    }
  });

  // —— BLOCK-247（Q2b）联网检索授权与预算 ——
  // 与 /api/network 的差别要说清：这里**即时生效**（每次出网现读），不返回 restartRequired。
  app.get('/api/web-access', (req, res) => {
    try {
      return res.json({ status: 'ok', webAccess: webSearch.getSnapshot() });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.put('/api/web-access', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const snapshot = webSearch.saveWebSearchConfig(req.body || {});
      return res.json({ status: 'ok', webAccess: snapshot });
    } catch (error) {
      return sendRejection(res, error);
    }
  });

  // —— BLOCK-454（P3）扫描件 OCR 授权与参数 ——
  // 与 /api/web-access 同构：即时生效、400 + diagnostics、默认关（云调用=付费副作用）。
  app.get('/api/ocr-access', (req, res) => {
    try {
      return res.json({ status: 'ok', ocrAccess: ocrConfig.getSnapshot() });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.put('/api/ocr-access', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const snapshot = ocrConfig.saveOcrConfig(req.body || {});
      return res.json({ status: 'ok', ocrAccess: snapshot });
    } catch (error) {
      return sendRejection(res, error);
    }
  });

  // —— BLOCK-454（P6）语音（ASR/TTS）授权与参数 ——
  // 与 /api/ocr-access 同构：即时生效、400 + diagnostics、默认关（云调用=付费副作用）。
  app.get('/api/speech-access', (req, res) => {
    try {
      return res.json({ status: 'ok', speechAccess: speechConfig.getSnapshot() });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.put('/api/speech-access', express.json({ limit: '16kb' }), (req, res) => {
    try {
      const snapshot = speechConfig.saveSpeechConfig(req.body || {});
      return res.json({ status: 'ok', speechAccess: snapshot });
    } catch (error) {
      return sendRejection(res, error);
    }
  });

  // —— BLOCK-519 本地 ASR 模型管理（不挂 capability ledger；落盘真值） ——
  app.get('/api/speech/local-models', (_req, res) => {
    try {
      return res.json({ status: 'ok', models: localAsrModel.listLocalAsrModels() });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.post('/api/speech/local-models/:id/download', async (req, res) => {
    try {
      const result = await localAsrModel.downloadLocalAsrModel(req.params.id);
      if (!result.ok) {
        return res.status(400).json({ status: 'error', error: result.code, message: result.message });
      }
      return res.json({ status: 'ok', ...result });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.delete('/api/speech/local-models/:id', (req, res) => {
    try {
      const result = localAsrModel.deleteLocalAsrModel(req.params.id);
      if (!result.ok) return res.status(400).json({ status: 'error', error: result.code });
      return res.json({ status: 'ok', ...result });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  // BLOCK-519 阶段二 — whisper 并列模型管理（与 SenseVoice local-models 并存，二选一下载）。
  app.get('/api/speech/whisper-models', (_req, res) => {
    try {
      const whisperModel = require('../helpers/whisper-model');
      return res.json({ status: 'ok', models: whisperModel.listWhisperModels() });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.post('/api/speech/whisper-models/:id/download', async (req, res) => {
    try {
      const whisperModel = require('../helpers/whisper-model');
      const result = await whisperModel.downloadWhisperModel(req.params.id);
      if (!result.ok) return res.status(400).json({ status: 'error', error: result.code, message: result.message });
      return res.json({ status: 'ok', ...result });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  app.delete('/api/speech/whisper-models/:id', (req, res) => {
    try {
      const whisperModel = require('../helpers/whisper-model');
      const result = whisperModel.deleteWhisperModel(req.params.id);
      if (!result.ok) return res.status(400).json({ status: 'error', error: result.code });
      return res.json({ status: 'ok', ...result });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });

  // BLOCK-519 阶段二 — composer 麦克风：音频 → 文本（复用 asr-provider 链，零新识别逻辑）。
  // 默认关不发请求（付费知情）；失败诚实 400 + 结构化 code，不伪造文本。
  app.post('/api/speech/transcribe', express.raw({ type: 'audio/*', limit: '8mb' }), async (req, res) => {
    try {
      const buffer = Buffer.isBuffer(req.body) ? req.body : null;
      if (!buffer || buffer.length === 0) {
        return res.status(400).json({ status: 'error', error: 'mic_audio_empty', message: '麦克风音频为空' });
      }
      const { transcribeMicAudio } = require('../helpers/composer-mic-transcribe');
      const result = await transcribeMicAudio({
        buffer,
        filename: String(req.query.filename || 'mic.wav'),
        config: speechConfig.getEffectiveConfig(),
      });
      if (!result.ok) {
        return res.status(400).json({ status: 'error', error: result.code, message: result.message });
      }
      return res.json({ status: 'ok', ...result });
    } catch (error) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  });
};
