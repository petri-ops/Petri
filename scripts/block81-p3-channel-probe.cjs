#!/usr/bin/env node
'use strict';
/**
 * block81-p3-channel-probe.cjs — BLOCK-81 P3：上游参数接受度矩阵（真渠道实测）。
 *
 * 回答的问题（P3 收口必需）：D3「去参重试」在**本机可用渠道**上能不能被真实触发？
 * 做法：对每个 OpenAI 兼容 chat 渠道各发两次最小请求——A 不带思考参数、B 带
 * `reasoning_effort: "high"`——比较状态码与响应字段形状。这是**直连上游**的探针
 * （不经我方能力位门控），只观测上游行为，不写任何配置。
 *
 * 判定口径（诚实）：
 *   - 无渠道以「未知/非法参数」类 400 拒绝 → D3 实机触发路径在本机不可达，
 *     该分支由确定性门禁（test/thinking-level-injection.test.mjs）覆盖，如实登记。
 *   - 出现此类 400 → D3 具备实机靶场，可在 UI/agent 链路上复验（本脚本只报可用性）。
 *   - 响应侧思考段字段名若非 `reasoning_content`，一并如实登记（我方解析面只认该名）。
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const http = require('node:http');

const ROOT = path.join(__dirname, '..');
const lib = require(path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const DATA_DIR = process.env.PETRI_LOCAL_DATA_DIR || path.join(ROOT, '.petri-dev-user-data', 'data');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-81');
const PROMPT = '只回复「收到」';

/** 凭据解析：与 core/petri-server/helpers/model-gateway.js getCredential 同口径。 */
function credentialKeyFor(profile) {
  const ref = String(profile.credentialRef || '');
  const sep = ref.indexOf(':');
  if (sep >= 0 && ref.slice(sep + 1)) return ref.slice(sep + 1);
  return profile.provider || ref;
}

function post(baseUrl, apiKey, payload, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const url = new URL(baseUrl);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    const reqPath = `${url.pathname.replace(/\/$/, '')}/chat/completions`;
    const req = client.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: reqPath,
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        authorization: `Bearer ${apiKey}`,
      },
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(d); } catch { /* 非 JSON 原样返回 */ }
        resolve({ status: res.statusCode, parsed, raw: d.slice(0, 400) });
      });
    });
    req.on('error', (e) => resolve({ status: 0, error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

/** 上游错误是否属「未知/非法参数」类（与 thinking-level.isUnknownParameterError 判据同源）。 */
function looksLikeUnknownParam(status, parsed) {
  if (status !== 400) return false;
  const text = JSON.stringify(parsed || {}).toLowerCase();
  return /unknown (parameter|argument|field|property)|unrecognized (parameter|field|property)|unsupported (parameter|argument|field|property)|invalid (parameter|argument|field|property)|unexpected (parameter|argument|field)/.test(text);
}

function reasoningFieldShapes(parsed) {
  const msg = parsed && parsed.choices && parsed.choices[0] && parsed.choices[0].message;
  if (!msg || typeof msg !== 'object') return [];
  return Object.keys(msg).filter((k) => /reason/i.test(k) && msg[k]);
}

(async () => {
  const run = lib.createRun({ name: 'block-81-p3-channel-probe', evidenceDir: EVIDENCE_DIR });
  const observations = { channels: [] };
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ai-settings.json'), 'utf8'));
    const creds = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ai-credentials.json'), 'utf8'));
    const profiles = (settings.model_profiles || []).filter((p) => (p.protocol || 'openai-compatible') === 'openai-compatible');

    for (const profile of profiles) {
      const apiKey = creds[credentialKeyFor(profile)];
      const entry = {
        profileId: profile.id,
        model: profile.model,
        baseUrl: profile.baseUrl,
        hasCredential: !!apiKey,
        withoutParam: null,
        withParam: null,
        rejectedParam: false,
      };
      if (apiKey) {
        const base = { model: profile.model, messages: [{ role: 'user', content: PROMPT }], max_tokens: 64, stream: false };
        const a = await post(profile.baseUrl, apiKey, base);
        const b = await post(profile.baseUrl, apiKey, { ...base, reasoning_effort: 'high' });
        entry.withoutParam = { status: a.status, error: a.error || null, reasoningFields: reasoningFieldShapes(a.parsed), finishReason: a.parsed && a.parsed.choices && a.parsed.choices[0] ? a.parsed.choices[0].finish_reason : null, errorText: a.status >= 400 ? String(a.raw).slice(0, 200) : null };
        entry.withParam = { status: b.status, error: b.error || null, reasoningFields: reasoningFieldShapes(b.parsed), finishReason: b.parsed && b.parsed.choices && b.parsed.choices[0] ? b.parsed.choices[0].finish_reason : null, errorText: b.status >= 400 ? String(b.raw).slice(0, 200) : null };
        entry.rejectedParam = looksLikeUnknownParam(b.status, b.parsed);
        entry.paramAccepted = b.status >= 200 && b.status < 300;
        lib.log(`${profile.id}: without=${a.status} with=${b.status} rejectedParam=${entry.rejectedParam}`);
      }
      observations.channels.push(entry);
    }

    const probed = observations.channels.filter((c) => c.withParam);
    const accepting = probed.filter((c) => c.paramAccepted);
    const rejecting = probed.filter((c) => c.rejectedParam);
    const reasoningShapes = [...new Set(probed.flatMap((c) => [...(c.withParam.reasoningFields || []), ...(c.withoutParam.reasoningFields || [])]))];

    observations.summary = {
      probedChannels: probed.length,
      acceptedParam: accepting.map((c) => c.profileId),
      rejectedParamAsUnknown: rejecting.map((c) => c.profileId),
      reasoningFieldShapesSeen: reasoningShapes,
    };

    run.assert('PR1_channels_probed', probed.length > 0,
      `已实测 ${probed.length} 个 OpenAI 兼容渠道（不含无凭据渠道）：${probed.map((c) => c.profileId).join(', ')}`);
    run.assert('PR2_no_unknown_param_rejection', rejecting.length === 0,
      rejecting.length === 0
        ? `本机无渠道以「未知/非法参数」400 拒绝 reasoning_effort → D3 去参重试的**实机触发路径不可达**，该分支由确定性门禁覆盖（已如实登记，非缺陷）`
        : `发现实机靶场：${rejecting.map((c) => c.profileId).join(', ')} 以未知参数 400 拒绝 → D3 可在 agent 链路复验`);
    run.assert('PR3_reasoning_field_shape', reasoningShapes.includes('reasoning_content') || reasoningShapes.length === 0,
      `上游思考段字段实测形状：${JSON.stringify(reasoningShapes)}（我方解析面只认 reasoning_content；其他形状如实登记为观察）`);

    return await run.finish({ observations });
  } catch (err) {
    run.assert('RUN_COMPLETED', false, `脚本异常：${err && err.message ? err.message : String(err)}`);
    observations.error = String((err && err.stack) || err).slice(0, 1200);
    return await run.finish({ observations });
  }
})().then((p) => process.exit(p && p.allPass ? 0 : 1)).catch((e) => { console.error('FATAL', e && e.message); process.exit(2); });
