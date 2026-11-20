/**
 * BLOCK-509 / C-55 VIDEO-P4 — 产品内一键成片出口契约（HK-01 红绿先行）。
 *
 * 钉住：主题→VideoProjectSpec 的确定性 draft、fail-closed、付费/外发确认文案。
 * 只测新增纯函数；compose_video 引擎与 P0 产物契约由 block482 测试继续守护。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../core/petri-server/helpers/video-brief-spec.js');
const P0 = require('../core/petri-server/helpers/video-compose.js');

const base = {
  topic: '为什么卫星能绕地球转',
  audience: '初中生',
  durationSec: 30,
  claims: [{ id: 'c1', text: '轨道运动是持续自由落体', sourceIds: ['s1'] }],
  sources: [{ id: 's1', title: 'NASA Orbital Mechanics', url: 'https://example.org/orbit' }],
};

test('A1 valid brief drafts a P0-compatible 30s spec', () => {
  const out = H.draftVideoSpecFromBrief(base);
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(out.presetCompliant, true);
  assert.equal(out.spec.goal.topic, base.topic);
  assert.equal(out.spec.goal.audience, base.audience);
  assert.equal(out.spec.goal.durationSec, 30);
  assert.equal(out.spec.goal.aspectRatio, '16:9');
  assert.equal(out.spec.scenes.length, 3);
  assert.ok(out.spec.scenes.every((s) => s.narration.trim() && s.visual.kind === 'card'));

  const normalized = P0.normalizeVideoSpec(out.spec);
  assert.equal(normalized.ok, true, JSON.stringify(normalized));
});

test('A2 confirmation prompt names paid TTS, local execution, and no external assets by default', () => {
  const out = H.draftVideoSpecFromBrief(base);
  assert.equal(out.ok, true);
  assert.equal(out.confirmation.required, true);
  assert.equal(out.confirmation.code, 'PAID_TTS_CONFIRMATION_REQUIRED');
  for (const fragment of ['付费', 'TTS', '本地执行', '外部素材默认关闭']) {
    assert.ok(out.confirmation.prompt.includes(fragment), `confirmation missing ${fragment}`);
  }
});

test('B1 fail-closed: missing topic / invalid duration / unsupported aspect', () => {
  assert.equal(H.draftVideoSpecFromBrief({ ...base, topic: '   ' }).code, 'missing_topic');
  assert.equal(H.draftVideoSpecFromBrief({ ...base, durationSec: 10 }).code, 'invalid_duration');
  assert.equal(H.draftVideoSpecFromBrief({ ...base, durationSec: 90 }).code, 'invalid_duration');
  assert.equal(H.draftVideoSpecFromBrief({ ...base, aspectRatio: '9:16' }).code, 'aspect_ratio_unsupported');
});

test('B2 fail-closed: claim references unknown source (tampering negative)', () => {
  const out = H.draftVideoSpecFromBrief({
    ...base,
    claims: [{ id: 'c1', text: '篡改来源', sourceIds: ['missing'] }],
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'unknown_source');
});

test('B3 fail-closed: image scene without provenance is rejected (tampering negative)', () => {
  const out = H.draftVideoSpecFromBrief({
    ...base,
    scenes: [{ id: 'sc1', narration: '旁白', visual: { kind: 'image', path: 'a.png' } }],
  });
  assert.equal(out.ok, false);
  assert.equal(out.code, 'asset_provenance_required');
});

test('C1 deterministic drafts are stable (same brief -> same spec JSON)', () => {
  const a = H.draftVideoSpecFromBrief(base);
  const b = H.draftVideoSpecFromBrief(base);
  assert.equal(JSON.stringify(a.spec), JSON.stringify(b.spec));
});
