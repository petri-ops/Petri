/**
 * BLOCK-482 实机成片证据生成器（一次性；非 CI，含用户授权的付费 TTS 调用）。
 * 真实 DeepSeek TTS + 真实 ffmpeg，产 3 镜头科普短视频与全产物，落本目录。
 * 运行：node acceptance/block482-c55-video-p0/probe-live.mjs
 * 云不可用时：如实写 external-blocked 记录，不伪造音频/成片。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const { composeVideo, normalizeVideoSpec } = require(path.join(ROOT, 'core/petri-server/helpers/video-compose.js'));
const { findFfmpegBinary } = require(path.join(ROOT, 'core/petri-server/helpers/ffmpeg-turntable.js'));

const SPEC = {
  schemaVersion: 1,
  goal: { topic: '为什么天空是蓝色的？', audience: '小学高年级', language: 'zh', durationSec: 30, aspectRatio: '16:9', style: '科普图形' },
  sources: [
    { id: 's1', kind: 'web', urlOrPath: 'https://en.wikipedia.org/wiki/Rayleigh_scattering', title: 'Rayleigh scattering（维基百科）', accessedAt: '2026-11-18', license: 'CC-BY-SA-4.0' },
    { id: 's2', kind: 'web', urlOrPath: 'https://science.nasa.gov/earth/earth-observatory/why-is-the-sky-blue/', title: 'Why is the sky blue?（NASA）', accessedAt: '2026-11-18', license: 'public-domain' },
  ],
  claims: [
    { id: 'c1', text: '阳光进入大气后，波长较短的蓝光比红光更容易被空气分子散射。', sourceIds: ['s1', 's2'], confidence: 'high' },
    { id: 'c2', text: '散射的蓝光从各个方向进入眼睛，因此晴天天空呈蓝色。', sourceIds: ['s2'], confidence: 'high' },
  ],
  scenes: [
    {
      id: 'sc1', narration: '你有没有想过，晴朗的天空为什么是蓝色的？答案藏在阳光和空气里。',
      visual: { kind: 'card', title: '为什么天空是蓝色的？', text: '阳光 + 大气 = 颜色之谜' },
      evidenceRefs: [], captions: [{ text: '晴朗的天空为什么是蓝色的？', startMs: 0, endMs: 4000 }],
    },
    {
      id: 'sc2', narration: '阳光看起来是白色的，其实由很多颜色组成。蓝光波长短，更容易被空气分子向四面八方散射。',
      visual: { kind: 'card', title: '瑞利散射', text: '蓝光波长短 → 更易被散射' },
      evidenceRefs: ['c1'], captions: [{ text: '蓝光波长短，更容易被散射', startMs: 0, endMs: 5000 }],
    },
    {
      id: 'sc3', narration: '这些被散射的蓝光从各个方向进入我们的眼睛，于是我们抬头看到的，就是一片蓝天。',
      visual: { kind: 'card', title: '我们看见蓝天', text: '散射蓝光进入眼睛' },
      evidenceRefs: ['c2'], captions: [{ text: '散射的蓝光进入眼睛 → 蓝天', startMs: 0, endMs: 5000 }],
    },
  ],
  audio: { voice: 'stella', format: 'wav' },
  render: { width: 1280, height: 720, fps: 24, codec: 'libx264', container: 'mp4' },
};

async function main() {
  const normalized = normalizeVideoSpec(SPEC);
  const record = {
    runAt: new Date().toISOString(),
    specPresetCompliant: normalized.presetCompliant,
    ttsAuthorization: '用户 2026-11-18 裁决「TTS 默认开」，仅视频窄口授权（不翻转全局 speech-config）',
    externalMaterials: '允许但须 provenance；本次仅 card 画面，外部来源记于 sources.md',
  };
  const bin = findFfmpegBinary();
  record.ffmpegBin = bin || null;
  if (!bin) {
    record.status = 'external-blocked';
    record.reason = 'ffmpeg 未安装或不在 PATH——诚实不可用，未伪造成片';
    fs.writeFileSync(path.join(HERE, 'live-record.json'), JSON.stringify(record, null, 2), 'utf8');
    console.log('[BLOCK-482] external-blocked: ffmpeg unavailable');
    return;
  }

  const result = await composeVideo({
    spec: SPEC,
    workspaceRoot: ROOT,
    outDir: HERE,
    deps: { findBinFn: () => bin },
  });
  record.result = result.ok ? { ok: true, qaStatus: result.qa.status, bundleSha256: result.manifest.bundleSha256, totalMs: result.manifest.totalMs } : { ok: false, code: result.code, message: result.message };
  record.status = result.ok ? (result.qa.status === 'machine_pass' ? 'machine_pass' : 'machine_fail') : 'external-blocked-or-failed';
  fs.writeFileSync(path.join(HERE, 'live-record.json'), JSON.stringify(record, null, 2), 'utf8');
  console.log('[BLOCK-482] status=' + record.status + ' code=' + (result.code || '') + ' msg=' + (result.message || '').slice(0, 200));
  if (result.ok) console.log('[BLOCK-482] bundleSha256=' + result.manifest.bundleSha256 + ' totalMs=' + result.manifest.totalMs);
}

main().catch((e) => {
  fs.writeFileSync(path.join(HERE, 'live-record.json'), JSON.stringify({ status: 'failed', error: String((e && e.message) || e).slice(0, 500) }, null, 2), 'utf8');
  console.error('[BLOCK-482] failed:', (e && e.message) || e);
});
