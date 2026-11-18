/* eslint-disable security/detect-object-injection */
/*
 * 理由（BLOCK-482 误报豁免）：r.manifest.artifacts[a].sha256 等下标访问作用于测试内
 * 自建的固定结构 fixture，键为常量下标，无外部输入，误报豁免留痕。
 */
/**
 * BLOCK-482 / C-55 VIDEO-P0 — VideoProjectSpec + compose_video 窄口契约（HK-01 红绿先行）。
 *
 * 蓝本：acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md §5 P0。
 * 钉住四组不变量：
 *   A) spec 校验 fail-closed（字段/来源/素材 provenance/画幅）
 *   B) timeline 单调 + 时长取真实音频（不虚构），caption 越界钳制
 *   C) SRT 格式与时基正确
 *   D) 编排失败诚实（capability_unavailable / tts 失败 / 无素材 / ffmpeg 失败均不产出「成功但不可用」MP4）
 * 篡改负测：来源缺失/画幅翻态/caption 越界/unknown_source 一律红。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../core/petri-server/helpers/video-compose.js');

function baseSpec(overrides = {}) {
  return {
    schemaVersion: 1,
    goal: { topic: '为什么天空是蓝色的', audience: '小学生', language: 'zh', durationSec: 36, aspectRatio: '16:9', style: '科普图形' },
    sources: [{ id: 's1', kind: 'web', urlOrPath: 'https://example.org/sky', title: '瑞利散射科普', accessedAt: '2026-11-18', license: 'CC-BY-4.0' }],
    claims: [{ id: 'c1', text: '短波蓝光更易被空气分子散射', sourceIds: ['s1'], confidence: 'high' }],
    scenes: [
      { id: 'sc1', narration: '天空为什么是蓝色的？', visual: { kind: 'card', title: '天空的颜色', text: '瑞利散射' }, evidenceRefs: ['c1'], captions: [{ text: '天空为什么是蓝色的？', startMs: 0, endMs: 3000 }] },
      { id: 'sc2', narration: '因为蓝光波长短，更容易被散射。', visual: { kind: 'card', title: '蓝光被散射', text: '波长越短越易散射' }, evidenceRefs: ['c1'] },
      { id: 'sc3', narration: '所以我们抬头看到的是蓝天。', visual: { kind: 'card', title: '我们看见蓝天', text: '散射的蓝光进入眼睛' }, evidenceRefs: ['c1'] },
    ],
    audio: { voice: 'stella', format: 'wav' },
    render: { width: 1280, height: 720, fps: 24, codec: 'libx264', container: 'mp4' },
    ...overrides,
  };
}

// ---------- A) spec 校验 fail-closed ----------

test('A0 — 常量契约：schemaVersion=1 / 默认 16:9 720p / 中文字体候选在场', () => {
  assert.equal(H.SCHEMA_VERSION, 1);
  assert.equal(H.DEFAULT_RENDER.width, 1280);
  assert.equal(H.DEFAULT_RENDER.height, 720);
  assert.equal(H.DEFAULT_RENDER.aspectRatio, '16:9');
  assert.equal(H.DEFAULT_RENDER.fps, 24);
  assert.ok(Array.isArray(H.CJK_FONT_CANDIDATES) && H.CJK_FONT_CANDIDATES.length > 0);
});

test('A1 — 合法 spec 规范化通过；缺省 render/audio 填默认；presetCompliant 判定真实', () => {
  const spec = baseSpec();
  delete spec.render;
  delete spec.audio;
  const r = H.normalizeVideoSpec(spec);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.spec.render.width, 1280);
  assert.equal(r.spec.audio.voice, 'stella');
  assert.equal(r.presetCompliant, true);
});

test('A2 — 篡改负测：画幅翻 9:16 → 拒（P0 固定 16:9）', () => {
  const spec = baseSpec();
  spec.goal.aspectRatio = '9:16';
  const r = H.normalizeVideoSpec(spec);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'aspect_ratio_unsupported');
});

test('A3 — 篡改负测：claim 引用不存在来源 → unknown_source（fail-closed）', () => {
  const spec = baseSpec();
  spec.claims[0].sourceIds = ['s-does-not-exist'];
  const r = H.normalizeVideoSpec(spec);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'unknown_source');
});

test('A4 — 外部素材无 provenance → 拒；带 license/sourceId 的 image 素材通过', () => {
  const noProv = baseSpec();
  noProv.scenes[0].visual = { kind: 'image', filePath: 'assets/sky.png' };
  assert.equal(H.normalizeVideoSpec(noProv).code, 'asset_provenance_required');

  const withProv = baseSpec();
  withProv.scenes[0].visual = { kind: 'image', filePath: 'assets/sky.png', sourceId: 's1', license: 'CC-BY-4.0' };
  const r = H.normalizeVideoSpec(withProv);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('A5 — 空旁白/镜头数为 0 → 拒，不臆造画面', () => {
  const empty = baseSpec({ scenes: [{ id: 'sc1', narration: '   ', visual: { kind: 'card', title: 'x', text: 'y' }, evidenceRefs: [] }] });
  assert.equal(H.normalizeVideoSpec(empty).code, 'empty_narration');
  assert.equal(H.normalizeVideoSpec(baseSpec({ scenes: [] })).code, 'no_scenes');
});

// ---------- B) timeline 单调 + 真实音频时长 ----------

test('B0 — timeline 由真实音频时长决定，单调递增无重叠', () => {
  const spec = baseSpec();
  const r = H.computeTimeline(spec.spec || spec, [4200, 5100, 3800]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.scenes.map((s) => s.startMs), [0, 4200, 9300]);
  assert.deepEqual(r.scenes.map((s) => s.endMs), [4200, 9300, 13100]);
  assert.equal(r.totalMs, 13100);
});

test('B1 — caption 越界被钳制在镜头区间内，不溢出总时长', () => {
  const spec = baseSpec();
  spec.scenes[0].captions = [{ text: '越界', startMs: -500, endMs: 99999 }];
  const r = H.computeTimeline(spec, [2000, 2000, 2000]);
  assert.equal(r.ok, true);
  assert.equal(r.scenes[0].captions[0].startMs, 0);
  assert.equal(r.scenes[0].captions[0].endMs, 2000);
  assert.ok(r.scenes.every((s) => s.captions.every((c) => c.endMs <= s.endMs && c.startMs >= s.startMs)));
});

test('B2 — 音频时长缺失/非正 → 拒（不虚构时长冒充镜头）', () => {
  const spec = baseSpec();
  assert.equal(H.computeTimeline(spec, [0, 2000, 2000]).code, 'invalid_audio_duration');
  assert.equal(H.computeTimeline(spec, [2000, 2000]).code, 'audio_duration_count_mismatch');
});

// ---------- C) SRT 时基 ----------

test('C0 — SRT 序号/时基/空行格式正确', () => {
  const tl = H.computeTimeline(baseSpec(), [1000, 1000, 1000]);
  const r = H.buildSrt(tl);
  assert.equal(r.ok, true);
  assert.ok(r.srt.includes('00:00:00,000 --> 00:00:01,000'));
  assert.ok(r.srt.includes('00:00:02,000 --> 00:00:03,000'));
  assert.equal((r.srt.match(/\n\n/g) || []).length >= 3, true);
});

// ---------- D) 编排失败诚实（不产出「成功但不可用」MP4） ----------

function fakeDeps(overrides = {}) {
  return {
    findBinFn: () => '/fake/ffmpeg.exe',
    ttsFn: async () => ({ ok: true, audio: Buffer.from('RIFFfake'), format: 'wav', voiceId: 'stella', cost: { requests: 1, chars: 10 } }),
    probeFn: async () => ({ ok: true, durationMs: 1200 }),
    execFileFn: (cmd, args) => {
      // 让输出 mp4 出现（模拟 ffmpeg 成功）
      const out = args && args[args.length - 1];
      if (out && String(out).endsWith('.mp4') && overrides.fs) overrides.fs.writeFileSync(out, Buffer.from('fake-mp4'));
      return { code: 0, stdout: '', stderr: '' };
    },
    fs: overrides.fs,
    path: overrides.path,
    ...overrides,
  };
}

test('D0 — ffmpeg 缺席 → capability_unavailable，零产物', async () => {
  const r = await H.composeVideo({ spec: baseSpec(), workspaceRoot: '/ws', outDir: '/ws/.petri/video/r0', deps: fakeDeps({ findBinFn: () => null }) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'capability_unavailable');
});

test('D1 — TTS 失败 → tts_failed 结构化，不写 video.mp4', async () => {
  const r = await H.composeVideo({ spec: baseSpec(), workspaceRoot: '/ws', outDir: '/ws/.petri/video/r1', deps: fakeDeps({ ttsFn: async () => ({ ok: false, code: 'tts_http_error', message: 'HTTP 401' }) }) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'tts_failed');
  assert.ok(r.message.includes('401'));
});

test('D2 — ffmpeg 超时/失败 → ffmpeg_failed，不声称成功', async () => {
  const r = await H.composeVideo({ spec: baseSpec(), workspaceRoot: '/ws', outDir: '/ws/.petri/video/r2', deps: fakeDeps({ execFileFn: () => ({ code: 124, stdout: '', stderr: 'ffmpeg_timeout' }) }) });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ffmpeg_failed');
});

test('D3 — 成功路径：产物清单齐 + manifest sha256 + QA 结构化（注入假 exec 不触碰真 ffmpeg）', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const os = require('node:os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-video-p0-'));
  const deps = fakeDeps({ fs, path, execFileFn: (cmd, args) => {
    const out = args && args[args.length - 1];
    if (out && String(out).endsWith('.mp4')) fs.writeFileSync(out, Buffer.from('fake-mp4'));
    return { code: 0, stdout: '', stderr: '' };
  } });
  const r = await H.composeVideo({ spec: baseSpec(), workspaceRoot: tmp, outDir: path.join(tmp, '.petri', 'video', 'r3'), deps });
  assert.equal(r.ok, true, JSON.stringify(r));
  for (const f of ['video.mp4', 'narration.wav', 'subtitles.srt', 'script.md', 'sources.md', 'video-project.json', 'qa-report.json', 'manifest.json']) {
    assert.ok(r.products[f], `缺产物 ${f}`);
  }
  assert.equal(r.manifest.artifacts.length, 7, 'manifest 自引用不入产物哈希（改以 bundleSha256 锚定）');
  assert.ok(r.manifest.artifacts.every((a) => /^[a-f0-9]{64}$/.test(a.sha256)));
  assert.match(r.manifest.bundleSha256, /^[a-f0-9]{64}$/);
  assert.equal(r.manifest.selfReference.name, 'manifest.json');
  fs.rmSync(tmp, { recursive: true, force: true });
});
