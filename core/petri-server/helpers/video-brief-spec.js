'use strict';

/**
 * helpers/video-brief-spec.js — BLOCK-509 / C-55 VIDEO-P4 产品内一键成片出口。
 *
 * 只做一件事：把用户的一句科普主题 + 受众 + 时长，确定性 draft 为 P0 可消费的
 * VideoProjectSpec，并复用 P0 的 normalizeVideoSpec 做 fail-closed 校验。
 *
 * 红线：
 *  - 纯函数、零新依赖、不联网、不写盘；
 *  - 不重新实现 P0 的 spec 校验/合成语义；
 *  - 付费 TTS / 本地 ffmpeg / 外部素材默认关都写进确认文案，交由既有
 *    ask_user_question 治理链显式确认，不在这里偷偷放行。
 */
const { normalizeVideoSpec, SCHEMA_VERSION } = require('./video-compose.js');

const PRESET_MIN_SEC = 30;
const PRESET_MAX_SEC = 60;

function fail(code, message) {
  return { ok: false, code, message };
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanSources(value) {
  return asArray(value)
    .filter((s) => s && typeof s === 'object' && String(s.id || '').trim())
    .map((s) => ({ ...s, id: String(s.id).trim() }));
}

function cleanClaims(value) {
  return asArray(value)
    .filter((c) => c && typeof c === 'object')
    .map((c, i) => ({
      ...c,
      id: String(c.id || `claim${i + 1}`).trim(),
      sourceIds: asArray(c.sourceIds).map(String),
    }));
}

function defaultScenes(topic, audience, claims) {
  const firstClaim = claims[0] && String(claims[0].text || '').trim();
  const secondClaim = claims[1] && String(claims[1].text || '').trim();
  const sceneText = [
    {
      title: '先问一个问题',
      text: `${topic} 为什么值得讲清楚？`,
      narration: `这条 ${30} 秒科普讲的是「${topic}」，面向${audience}。`,
      captions: [`主题：${topic}`, `受众：${audience}`],
    },
    {
      title: '核心机制',
      text: firstClaim || '先看最关键的一条证据。',
      narration: firstClaim ? `核心机制是：${firstClaim}。` : '先看最关键的一条证据。',
      captions: [firstClaim || '先看最关键的一条证据。'],
    },
    {
      title: '边界与结论',
      text: secondClaim || '结论要带边界，不把推测说成事实。',
      narration: secondClaim
        ? `还要记住：${secondClaim}。结论要带边界。`
        : '结论要带边界，不把推测说成事实。',
      captions: [secondClaim || '结论要带边界，不把推测说成事实。'],
    },
  ];
  return sceneText.map((s, i) => ({
    id: `sc${i + 1}`,
    narration: s.narration,
    visual: { kind: 'card', title: s.title, text: s.text },
    captions: s.captions,
    evidenceRefs: claims.length ? [claims[0].id] : [],
  }));
}

function buildConfirmationPrompt(spec) {
  const scenes = spec && Array.isArray(spec.scenes) ? spec.scenes.length : 0;
  const duration = spec && spec.goal ? spec.goal.durationSec : 0;
  return [
    `将按「${spec && spec.goal ? spec.goal.topic : ''}」生成 ${scenes} 镜头、约 ${duration} 秒科普视频。`,
    '将调用付费 DeepSeek TTS 生成旁白并做本地执行（ffmpeg 合成）；可能产生少量费用。',
    '外部素材默认关闭；仅使用本地/用户提供的材料，缺来源与许可即拒绝。',
    '成片质检为 machine_pass，观感终审仍由你确认。',
  ].join('\n');
}

/**
 * 从一句 brief draft 出 P0 可消费的 VideoProjectSpec。
 * @param {{topic:string, audience?:string, durationSec?:number, aspectRatio?:string,
 *          sources?:Array, claims?:Array, scenes?:Array, language?:string}} input
 */
function draftVideoSpecFromBrief(input) {
  if (!input || typeof input !== 'object') return fail('invalid_brief', 'brief 必须是对象');
  const topic = String(input.topic || '').trim();
  if (!topic) return fail('missing_topic', 'goal.topic 不能为空');
  const audience = String(input.audience || '通用观众').trim() || '通用观众';
  const durationSec = Number(input.durationSec == null ? 30 : input.durationSec);
  if (!Number.isFinite(durationSec) || durationSec < PRESET_MIN_SEC || durationSec > PRESET_MAX_SEC) {
    return fail('invalid_duration', `P4 预置时长 ${PRESET_MIN_SEC}–${PRESET_MAX_SEC} 秒，收到 ${input.durationSec}`);
  }
  const aspectRatio = String(input.aspectRatio || '16:9');
  if (aspectRatio !== '16:9') return fail('aspect_ratio_unsupported', `仅支持 16:9，收到 ${aspectRatio}`);

  const sources = cleanSources(input.sources);
  const claims = cleanClaims(input.claims);
  const scenes = asArray(input.scenes).length
    ? asArray(input.scenes).map((s, i) => ({ ...s, id: String(s.id || `sc${i + 1}`) }))
    : defaultScenes(topic, audience, claims);

  const normalized = normalizeVideoSpec({
    schemaVersion: SCHEMA_VERSION,
    goal: {
      topic,
      audience,
      durationSec,
      aspectRatio,
      language: String(input.language || 'zh'),
    },
    sources,
    claims,
    scenes,
    audio: { voice: 'stella', format: 'wav' },
  });
  if (!normalized.ok) return normalized;

  return {
    ok: true,
    spec: normalized.spec,
    presetCompliant: normalized.presetCompliant,
    warnings: normalized.warnings,
    confirmation: {
      required: true,
      code: 'PAID_TTS_CONFIRMATION_REQUIRED',
      prompt: buildConfirmationPrompt(normalized.spec),
    },
  };
}

module.exports = {
  PRESET_MIN_SEC,
  PRESET_MAX_SEC,
  draftVideoSpecFromBrief,
  buildConfirmationPrompt,
};
