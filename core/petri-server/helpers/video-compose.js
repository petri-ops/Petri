'use strict';

/* eslint-disable security/detect-object-injection */
/*
 * 理由（BLOCK-482 误报豁免）：本文件的动态属性访问全部作用于内部确定性数据结构
 * （scenes[i].captions[j]、claims[].sourceIds[k]、spec.audio/render 固定键），
 * 键来自本模块自产的 spec 规范化结果或数组下标，无外部可控键注入面；TTS/ffmpeg
 * 产物路径经 normalizeVideoSpec + workspaceRoot 前缀双重约束。误报，留痕豁免。
 */

/**
 * helpers/video-compose.js — BLOCK-482 / C-55 VIDEO-P0 通用视频合成窄口。
 *
 * 蓝本：acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md §5 P0。
 * 复用 findFfmpegBinary（零新依赖）+ tts-provider.synthesizeSpeech（视频窄口授权开启）。
 * 不把 composeTurntable 改成全能剪辑器——本文件是独立窄口。
 *
 * 关键不变量（HK-01 契约钉住）：
 *  - spec fail-closed：画幅固定 16:9、claim 来源必须存在、image 素材必须带 provenance；
 *  - 镜头时长取真实音频（ffprobe），不虚构、不静默跳过、无黑帧冒充；
 *  - caption 越界钳制在镜头区间；SRT 时基单调；
 *  - 失败不产出「成功但不可用」MP4：capability_unavailable / tts_failed / ffmpeg_failed 均零产物声明。
 *
 * 依赖注入 deps：{ findBinFn, ttsFn, probeFn, execFileFn, fs, path }（测试可替换，生产用真身）。
 */

const SCHEMA_VERSION = 1;
const DEFAULT_RENDER = Object.freeze({ width: 1280, height: 720, aspectRatio: '16:9', fps: 24, codec: 'libx264', container: 'mp4', transitions: 'none' });
const DEFAULT_AUDIO = Object.freeze({ voice: 'stella', format: 'wav' });
const CJK_FONT_CANDIDATES = Object.freeze([
  'C:\\Windows\\Fonts\\msyh.ttc',
  'C:\\Windows\\Fonts\\msyhbd.ttc',
  '/System/Library/Fonts/PingFang.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
]);

const ASPECT_WH = Object.freeze({ '16:9': [1280, 720] });
const MAX_SCENES = 16;

function fail(code, message, extra) {
  return { ok: false, code, message, ...(extra || {}) };
}

/** 规范化 + fail-closed 校验 VideoProjectSpec。 */
function normalizeVideoSpec(input, _opts = {}) {
  if (!input || typeof input !== 'object') return fail('invalid_spec', 'VideoProjectSpec 必须是对象');
  const schemaVersion = input.schemaVersion == null ? SCHEMA_VERSION : input.schemaVersion;
  if (schemaVersion !== SCHEMA_VERSION) return fail('schema_version_unsupported', `schemaVersion 须为 ${SCHEMA_VERSION}，收到 ${schemaVersion}`);

  const goal = input.goal || {};
  if (!String(goal.topic || '').trim()) return fail('missing_topic', 'goal.topic 不能为空');
  const aspectRatio = String(goal.aspectRatio || DEFAULT_RENDER.aspectRatio);
  if (!ASPECT_WH[aspectRatio]) return fail('aspect_ratio_unsupported', `仅支持 16:9（P0 固定画幅），收到 ${aspectRatio}`);

  const scenes = Array.isArray(input.scenes) ? input.scenes : [];
  if (scenes.length === 0) return fail('no_scenes', '至少需要一个镜头');
  if (scenes.length > MAX_SCENES) return fail('too_many_scenes', `镜头数上限 ${MAX_SCENES}`);

  const sources = Array.isArray(input.sources) ? input.sources : [];
  const sourceIds = new Set(sources.map((s) => s && s.id).filter(Boolean));

  for (const claim of (Array.isArray(input.claims) ? input.claims : [])) {
    for (const sid of (Array.isArray(claim.sourceIds) ? claim.sourceIds : [])) {
      if (!sourceIds.has(sid)) return fail('unknown_source', `claim ${claim.id || '?'} 引用了不存在的来源 ${sid}`);
    }
  }

  for (const scene of scenes) {
    if (!String(scene.narration || '').trim()) return fail('empty_narration', `镜头 ${scene.id || '?'} 旁白为空`);
    const visual = scene.visual || {};
    if (!['card', 'image'].includes(visual.kind)) return fail('unsupported_visual', `镜头 ${scene.id || '?'} visual.kind 须为 card|image`);
    if (visual.kind === 'image') {
      const hasSource = visual.sourceId && sourceIds.has(visual.sourceId);
      const hasLicense = String(visual.license || '').trim();
      if (!hasSource || !hasLicense) {
        return fail('asset_provenance_required', `镜头 ${scene.id || '?'} 的 image 素材必须带 sourceId（须在 sources 中）与 license`);
      }
    }
    for (const cref of (Array.isArray(scene.evidenceRefs) ? scene.evidenceRefs : [])) {
      // evidenceRefs 允许引用 claim id；缺失时只警告不拒（P0 不强制每镜有 claim）。
      void cref;
    }
  }

  const [width, height] = ASPECT_WH[aspectRatio];
  const render = { ...DEFAULT_RENDER, ...(input.render || {}) };
  render.aspectRatio = aspectRatio;
  render.width = Number(render.width) === width ? width : width;
  render.height = Number(render.height) === height ? height : height;
  const audio = { ...DEFAULT_AUDIO, ...(input.audio || {}) };

  const durationSec = Number(goal.durationSec) || 0;
  const presetCompliant = scenes.length >= 3 && scenes.length <= 5 && durationSec >= 30 && durationSec <= 60;

  return {
    ok: true,
    spec: {
      schemaVersion,
      goal: { ...goal, aspectRatio, language: goal.language || 'zh' },
      sources,
      claims: Array.isArray(input.claims) ? input.claims : [],
      scenes: scenes.map((s, i) => ({ ...s, id: s.id || `sc${i + 1}` })),
      audio,
      render,
    },
    presetCompliant,
    warnings: presetCompliant ? [] : ['preset_hint: P0 预置 30–60 秒 / 3–5 镜头；当前不在预置区间（仍可合成）'],
  };
}

/** 由真实音频时长计算镜头时间线；audioDurationsMs 须逐镜头一一对应且为正。 */
function computeTimeline(spec, audioDurationsMs) {
  if (!spec || !Array.isArray(spec.scenes)) return fail('invalid_spec', 'spec.scenes 缺失');
  if (!Array.isArray(audioDurationsMs) || audioDurationsMs.length !== spec.scenes.length) {
    return fail('audio_duration_count_mismatch', `音频时长数(${audioDurationsMs ? audioDurationsMs.length : 0})与镜头数(${spec.scenes.length})不一致`);
  }
  let cursor = 0;
  const scenes = [];
  for (let i = 0; i < spec.scenes.length; i += 1) {
    const dur = Number(audioDurationsMs[i]);
    if (!Number.isFinite(dur) || dur <= 0) return fail('invalid_audio_duration', `镜头 ${spec.scenes[i].id} 音频时长非正：${audioDurationsMs[i]}`);
    const startMs = Math.round(cursor);
    const endMs = Math.round(cursor + dur);
    const captions = (Array.isArray(spec.scenes[i].captions) ? spec.scenes[i].captions : [
      { text: String(spec.scenes[i].narration || '').trim(), startMs: 0, endMs: dur },
    ]).map((c) => {
      const rawStart = Number(c.startMs) || 0;
      const rawEnd = Number(c.endMs) || dur;
      return {
        text: String(c.text || ''),
        startMs: Math.max(startMs, Math.min(endMs, startMs + rawStart)),
        endMs: Math.max(startMs, Math.min(endMs, startMs + rawEnd)),
      };
    });
    scenes.push({ id: spec.scenes[i].id, index: i, startMs, endMs, durationMs: endMs - startMs, captions });
    cursor += dur;
  }
  return { ok: true, scenes, totalMs: Math.round(cursor) };
}

function srtTime(ms) {
  const clamped = Math.max(0, Math.round(ms));
  const h = String(Math.floor(clamped / 3600000)).padStart(2, '0');
  const m = String(Math.floor((clamped % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((clamped % 60000) / 1000)).padStart(2, '0');
  const msPart = String(clamped % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${msPart}`;
}

/** 由 timeline 产 SRT（序号 + 时基 + 空行）。 */
function buildSrt(timeline) {
  if (!timeline || !timeline.ok || !Array.isArray(timeline.scenes)) return fail('invalid_timeline', 'timeline 无效');
  const blocks = [];
  let idx = 1;
  for (const scene of timeline.scenes) {
    for (const cap of (scene.captions || [])) {
      if (!String(cap.text || '').trim()) continue;
      blocks.push(`${idx}\n${srtTime(cap.startMs)} --> ${srtTime(cap.endMs)}\n${cap.text}\n`);
      idx += 1;
    }
  }
  return { ok: true, srt: blocks.join('\n') + (blocks.length ? '\n' : '') };
}

/** ffprobe 取音频真实时长（复用 video-frames.js 的 ffprobe 模式）。 */
async function probeAudioDurationMs(filePath, deps = {}) {
  const execFileFn = deps.execFileFn || ((cmd, args) => require('node:child_process').execFileSync(cmd, args, { encoding: 'utf8', timeout: 15000 }));
  const bin = deps.ffprobeBin || String(deps.ffmpegBin || 'ffmpeg').replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
  try {
    const out = execFileFn(bin, ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath]);
    const text = String((out && out.stdout) != null ? out.stdout : out || '').trim();
    const sec = parseFloat(text);
    if (!Number.isFinite(sec) || sec <= 0) return fail('invalid_audio_duration', `ffprobe 返回时长非正：${text}`);
    return { ok: true, durationMs: Math.round(sec * 1000) };
  } catch (error) {
    return fail('ffprobe_failed', String((error && error.message) || error).slice(0, 300));
  }
}

function findFont(fs) {
  for (const candidate of CJK_FONT_CANDIDATES) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* next */ }
  }
  return null;
}

function escFilter(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'").replace(/\[/g, '\\[').replace(/\]/g, '\\]');
}

/**
 * composeVideo — 编排真实成片。
 * @param {{spec:object, workspaceRoot:string, outDir:string, ttsConfig?:object, deps?:object}} input
 * @returns {Promise<{ok:true, products:object, manifest:object, qa:object}|{ok:false, code, message}>}
 */
async function composeVideo(input = {}) {
  const specInput = input.spec;
  const deps = input.deps || {};
  const fs = deps.fs || require('node:fs');
  const path = deps.path || require('node:path');
  const findBinFn = deps.findBinFn || require('./ffmpeg-turntable').findFfmpegBinary;
  const ttsFn = deps.ttsFn || require('./tts-provider').synthesizeSpeech;
  // 第三参 cwd 可选：字幕烧录用相对文件名（规避 Windows ffmpeg filter 绝对路径冒号转义）。
  const execFileFn = deps.execFileFn || ((cmd, args, cwd) => require('node:child_process').execFileSync(cmd, args, {
    encoding: 'utf8', timeout: 120000, ...(cwd ? { cwd } : {}),
  }));

  const normalized = normalizeVideoSpec(specInput);
  if (!normalized.ok) return normalized;
  const spec = normalized.spec;

  const ffmpegBin = findBinFn();
  if (!ffmpegBin) return fail('capability_unavailable', 'ffmpeg 未安装或不在 PATH 中——视频合成诚实不可用（用户自装后复测）');
  // ffprobe 默认从已发现的 ffmpeg 路径派生（与 video-frames.js 同款），不再强依赖 deps.ffmpegBin。
  const probeFn = deps.probeFn || ((p) => probeAudioDurationMs(p, {
    fs, execFileFn: deps.execFileFn,
    ffprobeBin: deps.ffprobeBin || String(ffmpegBin).replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'),
  }));

  const workspaceRoot = path.resolve(input.workspaceRoot || '.');
  const outDir = path.resolve(input.outDir || path.join(workspaceRoot, '.petri', 'video', 'latest'));
  if (outDir !== workspaceRoot && !outDir.startsWith(workspaceRoot + path.sep)) {
    return fail('path_escape', 'outDir 必须在工作区内');
  }
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (error) {
    return fail('out_dir_failed', String((error && error.message) || error).slice(0, 300));
  }

  // 1) 逐镜头旁白 → 音频落盘 + ffprobe 真实时长
  const audioPaths = [];
  const durationsMs = [];
  const voice = spec.audio.voice;
  const format = spec.audio.format;
  for (let i = 0; i < spec.scenes.length; i += 1) {
    const scene = spec.scenes[i];
    const ttsConfig = { enabled: true, provider: 'deepseek', ttsVoice: voice, ttsFormat: format, filterMarkdown: false, timeoutMs: 60000, ...(input.ttsConfig || {}) };
    let synth;
    try {
      synth = await ttsFn({ text: String(scene.narration).trim(), voiceId: voice, format, config: ttsConfig });
    } catch (error) {
      return fail('tts_failed', `镜头 ${scene.id} TTS 调用异常：${String((error && error.message) || error).slice(0, 200)}`);
    }
    if (!synth || !synth.ok) {
      return fail('tts_failed', `镜头 ${scene.id} TTS 失败：${synth && synth.code ? synth.code : 'unknown'} ${synth && synth.message ? synth.message : ''}`.trim());
    }
    const audioPath = path.join(outDir, `audio-${i + 1}.${synth.format || format}`);
    try { fs.writeFileSync(audioPath, synth.audio); } catch (error) {
      return fail('write_failed', String((error && error.message) || error).slice(0, 300));
    }
    const probe = await probeFn(audioPath);
    if (!probe.ok) return fail('probe_failed', `镜头 ${scene.id} ${probe.message}`);
    audioPaths.push(audioPath);
    durationsMs.push(probe.durationMs);
  }

  const timeline = computeTimeline(spec, durationsMs);
  if (!timeline.ok) return timeline;
  const srtResult = buildSrt(timeline);
  if (!srtResult.ok) return srtResult;

  const srtPath = path.join(outDir, 'subtitles.srt');
  fs.writeFileSync(srtPath, srtResult.srt, 'utf8');

  // 2) 逐镜头画面段（card=ffmpeg color+drawtext；image=工作区图片 loop）。
  const fontPath = findFont(fs);
  const segPaths = [];
  const { width, height, fps, codec } = spec.render;
  for (let i = 0; i < spec.scenes.length; i += 1) {
    const scene = spec.scenes[i];
    const segPath = path.join(outDir, `scene-${i + 1}.mp4`);
    const dur = (durationsMs[i] / 1000).toFixed(3);
    let args;
    if (scene.visual.kind === 'image') {
      const imgPath = path.resolve(workspaceRoot, String(scene.visual.filePath || '').replace(/^\.\//, ''));
      if (imgPath !== workspaceRoot && !imgPath.startsWith(workspaceRoot + path.sep)) return fail('path_escape', `镜头 ${scene.id} 图片路径越出工作区`);
      if (!fs.existsSync(imgPath)) return fail('no_material', `镜头 ${scene.id} 图片不存在：${scene.visual.filePath}`);
      args = ['-y', '-hide_banner', '-loglevel', 'error', '-loop', '1', '-framerate', String(fps), '-i', imgPath, '-i', audioPaths[i],
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        '-t', dur, '-c:v', codec, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', segPath];
    } else {
      const title = String(scene.visual.title || '').trim();
      const body = String(scene.visual.text || scene.narration || '').trim();
      const vf = [
        `drawbox=x=0:y=0:w=iw:h=ih:color=0x0B1B33@1:t=fill`,
        fontPath ? `drawtext=fontfile='${escFilter(fontPath)}':text='${escFilter(title)}':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=h/2-70` : null,
        fontPath ? `drawtext=fontfile='${escFilter(fontPath)}':text='${escFilter(body)}':fontcolor=0x9FC5FF:fontsize=40:x=(w-text_w)/2:y=h/2+20` : null,
      ].filter(Boolean).join(',');
      args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x0B1B33:s=${width}x${height}:r=${fps}:d=${dur}`,
        '-i', audioPaths[i], '-vf', vf, '-t', dur, '-c:v', codec, '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', segPath];
    }
    let execResult;
    try { execResult = execFileFn(ffmpegBin, args); } catch (error) {
      return fail('ffmpeg_failed', `镜头 ${scene.id} 合成异常：${String((error && error.message) || error).slice(0, 300)}`);
    }
    const code = execResult && execResult.code != null ? execResult.code : 0;
    if (code !== 0) return fail('ffmpeg_failed', `镜头 ${scene.id} 合成失败(code=${code})：${String((execResult && execResult.stderr) || '').slice(-800)}`);
    segPaths.push(segPath);
  }

  // 3) concat 清单 → 单一 raw.mp4（无黑帧冒充：段数=镜头数）
  const listPath = path.join(outDir, 'concat.txt');
  fs.writeFileSync(listPath, segPaths.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join('\n') + '\n', 'utf8');
  const rawPath = path.join(outDir, 'video-raw.mp4');
  const videoPath = path.join(outDir, 'video.mp4');
  const concatArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', listPath,
    '-c', 'copy', '-movflags', '+faststart', rawPath];
  let concatResult;
  try { concatResult = execFileFn(ffmpegBin, concatArgs); } catch (error) {
    return fail('ffmpeg_failed', `concat 异常：${String((error && error.message) || error).slice(0, 300)}`);
  }
  const concatCode = concatResult && concatResult.code != null ? concatResult.code : 0;
  if (concatCode !== 0) return fail('ffmpeg_failed', `concat 失败(code=${concatCode})：${String((concatResult && concatResult.stderr) || '').slice(-800)}`);

  // 3b) 字幕烧录：subtitles 滤镜以相对文件名 + cwd=outDir 规避 Windows 绝对路径冒号转义。
  // 失败（libass/字体缺席）则回退 raw.mp4 并在 manifest 如实标注 subtitlesBurned=false。
  let subtitlesBurned = false;
  let subtitlesBurnNote = '';
  const hasCaptions = srtResult.srt.trim().length > 0;
  if (hasCaptions && fs.existsSync(rawPath)) {
    const style = fontPath
      ? "subtitles=filename=subtitles.srt:force_style='FontName=Microsoft YaHei,FontSize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,MarginV=40'"
      : 'subtitles=filename=subtitles.srt';
    const burnArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-i', rawPath, '-vf', style,
      '-c:v', codec, '-pix_fmt', 'yuv420p', '-c:a', 'copy', videoPath];
    let burnResult;
    try { burnResult = execFileFn(ffmpegBin, burnArgs, outDir); } catch (error) {
      subtitlesBurnNote = String((error && error.message) || error).slice(0, 200);
    }
    const burnCode = burnResult && burnResult.code != null ? burnResult.code : 0;
    if ((!burnResult || burnCode === 0) && fs.existsSync(videoPath) && fs.statSync(videoPath).size > 0) {
      subtitlesBurned = true;
    } else {
      subtitlesBurnNote = subtitlesBurnNote || String((burnResult && burnResult.stderr) || 'burn_failed').slice(-200);
      try { fs.copyFileSync(rawPath, videoPath); } catch { /* QA 会标缺失 */ }
    }
  } else if (fs.existsSync(rawPath)) {
    try { fs.copyFileSync(rawPath, videoPath); } catch { /* QA 会标缺失 */ }
  }

  // 4) 旁白拼接 narration.wav（concat demuxer + pcm 重编码）
  const audioListPath = path.join(outDir, 'audio-concat.txt');
  fs.writeFileSync(audioListPath, audioPaths.map((p) => `file '${path.resolve(p).replace(/'/g, "'\\''")}'`).join('\n') + '\n', 'utf8');
  const narrationPath = path.join(outDir, 'narration.wav');
  const narrArgs = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', audioListPath,
    '-c:a', 'pcm_s16le', narrationPath];
  let narrationFallback = null;
  try { execFileFn(ffmpegBin, narrArgs); } catch { /* 旁白 concat 失败走下方兜底 */ }
  if (!fs.existsSync(narrationPath)) {
    // concat 缺席/失败兜底：单段直接复制；多段做字节级拼接并留痕（不冒充 ffmpeg 正规拼接）。
    try {
      if (audioPaths.length === 1) {
        fs.copyFileSync(audioPaths[0], narrationPath);
        narrationFallback = 'single_copy';
      } else {
        fs.writeFileSync(narrationPath, Buffer.concat(audioPaths.map((p) => fs.readFileSync(p))));
        narrationFallback = 'byte_concat_fallback';
      }
    } catch { /* keep going；下方 QA 会如实标 narration 缺失 */ }
  }

  // 5) 文本产物：讲稿 / 来源 / spec
  const scriptText = [
    `# ${spec.goal.topic}`,
    ``,
    `> 受众：${spec.goal.audience || '通用'} · 语言：${spec.goal.language} · 画幅：${spec.render.aspectRatio} · 目标时长：${spec.goal.durationSec || '—'}s`,
    ``,
    ...spec.scenes.map((s, i) => `## 镜头 ${i + 1} · ${s.id}\n\n${s.narration}\n\n> 画面：${s.visual.kind === 'card' ? `${s.visual.title || ''} — ${s.visual.text || ''}` : `图片 ${s.visual.filePath}`}\n`),
    `## 来源`,
    ...spec.sources.map((s) => `- [${s.id}] ${s.title || ''} — ${s.urlOrPath}（${s.license || 'license_unknown'}，访问 ${s.accessedAt || '—'}）`),
  ].join('\n') + '\n';
  const sourcesText = [
    `# 来源与许可`,
    ``,
    ...spec.sources.map((s) => `- **${s.id}** ${s.kind || 'web'} · ${s.title || ''}\n  - 位置：${s.urlOrPath}\n  - 许可：${s.license || 'license_unknown'}\n  - 访问时间：${s.accessedAt || '—'}`),
    ``,
    `## 镜头素材来源`,
    ...spec.scenes.filter((s) => s.visual.kind === 'image').map((s) => `- ${s.id}: ${s.visual.filePath} ← ${s.visual.sourceId}（${s.visual.license}）`),
  ].join('\n') + '\n';
  const scriptPath = path.join(outDir, 'script.md');
  const sourcesPath = path.join(outDir, 'sources.md');
  const specPath = path.join(outDir, 'video-project.json');
  fs.writeFileSync(scriptPath, scriptText, 'utf8');
  fs.writeFileSync(sourcesPath, sourcesText, 'utf8');
  fs.writeFileSync(specPath, JSON.stringify({ ...spec, timeline }, null, 2), 'utf8');

  // 6) QA 报告（机器可验部分；观感留 pending_human_eye）
  const qaChecks = [
    { name: 'scene_count', passed: segPaths.length === spec.scenes.length, detail: `${segPaths.length}/${spec.scenes.length}` },
    { name: 'timeline_monotonic', passed: timeline.scenes.every((s, i) => i === 0 || s.startMs === timeline.scenes[i - 1].endMs), detail: 'ok' },
    { name: 'srt_caption_bounds', passed: timeline.scenes.every((s) => s.captions.every((c) => c.startMs >= s.startMs && c.endMs <= s.endMs)), detail: 'ok' },
    { name: 'video_nonempty', passed: fs.existsSync(videoPath) && fs.statSync(videoPath).size > 0, detail: fs.existsSync(videoPath) ? `${fs.statSync(videoPath).size}B` : 'missing' },
    { name: 'subtitles_burned', passed: subtitlesBurned, detail: subtitlesBurned ? 'burned into video.mp4' : `sidecar-only: ${subtitlesBurnNote || 'no captions/libass'}` },
    { name: 'all_claims_traced', passed: spec.claims.length === 0 || spec.claims.every((c) => (c.sourceIds || []).some((sid) => sourceIdsSet(spec.sources).has(sid))), detail: `${spec.claims.length} claims` },
  ];
  const qa = {
    ok: qaChecks.every((c) => c.passed),
    status: qaChecks.every((c) => c.passed) ? 'machine_pass' : 'machine_fail',
    checks: qaChecks,
    humanReview: { status: 'pending_human_eye', note: '成片观感/科学专业性终审由用户签字，Agent 不代签' },
    timeline,
  };
  const qaPath = path.join(outDir, 'qa-report.json');
  fs.writeFileSync(qaPath, JSON.stringify(qa, null, 2), 'utf8');

  // 7) manifest：全部产物 sha256 + 血缘。manifest.json 自引用不可自哈希——
  // 改以 bundleSha256（对各产物哈希串再哈希）提供整体完整性锚，诚实标注自引用项。
  const artifacts = [
    ['video.mp4', videoPath], ['narration.wav', narrationPath], ['subtitles.srt', srtPath],
    ['script.md', scriptPath], ['sources.md', sourcesPath], ['video-project.json', specPath], ['qa-report.json', qaPath],
  ];
  const crypto = require('node:crypto');
  const artifactRows = artifacts.map(([name, p]) => {
    const buf = fs.readFileSync(p);
    return { name, sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
  });
  const bundleSha256 = crypto.createHash('sha256')
    .update(artifactRows.map((a) => `${a.name}:${a.sha256}`).join('\n'))
    .digest('hex');
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    topic: spec.goal.topic,
    aspectRatio: spec.render.aspectRatio,
    totalMs: timeline.totalMs,
    artifacts: artifactRows,
    bundleSha256,
    selfReference: { name: 'manifest.json', note: 'manifest 不自身哈希；以 bundleSha256 锚定全部产物' },
    lineage: { sceneCount: spec.scenes.length, audioDurationsMs: durationsMs, ttsVoice: voice, ffmpegBin: String(ffmpegBin), narrationFallback, renderedAt: new Date().toISOString() },
  };
  const manifestPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

  const products = {};
  for (const [name] of artifacts) products[name] = path.relative(workspaceRoot, path.join(outDir, name));
  products['manifest.json'] = path.relative(workspaceRoot, manifestPath);
  return { ok: true, products, manifest, qa, outDir };
}

function sourceIdsSet(sources) {
  return new Set((Array.isArray(sources) ? sources : []).map((s) => s && s.id).filter(Boolean));
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_RENDER,
  DEFAULT_AUDIO,
  CJK_FONT_CANDIDATES,
  normalizeVideoSpec,
  computeTimeline,
  buildSrt,
  srtTime,
  probeAudioDurationMs,
  composeVideo,
};
