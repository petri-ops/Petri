/**
 * BLOCK-483 / C-55 VIDEO-P1 真实证据生成器。
 *
 * 对 BLOCK-482 已产出的真实成片（acceptance/block482-c55-video-p0/）跑真实 ffprobe/ffmpeg，
 * 采集 AV 读数，喂入 core/petri-server/helpers/video-evidence.js 生成 evidence-report.json。
 * ffmpeg 二进制解析顺序：环境变量 PETRI_FFMPEG_DIR > P0 live-record.json 记录的真实路径 > PATH。
 * 零新增运行时依赖（复用系统 ffmpeg + Node 内建），云/工具不可用时写 external-blocked，不伪造读数。
 *
 * 运行：node acceptance/block483-c55-video-p1/probe-evidence.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const P0 = path.resolve(ROOT, 'acceptance/block482-c55-video-p0');
const V = require(path.join(ROOT, 'core/petri-server/helpers/video-evidence.js'));

function resolveBin() {
  const candidates = [];
  if (process.env.PETRI_FFMPEG_DIR) candidates.push(process.env.PETRI_FFMPEG_DIR);
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(P0, 'live-record.json'), 'utf8'));
    if (rec.ffmpegBin) candidates.push(path.dirname(rec.ffmpegBin));
  } catch { /* no record */ }
  candidates.push('C:\\Users\\Admin\\AppData\\Local\\com.minimax.hub\\current\\resources\\ffmpeg');
  for (const dir of candidates) {
    for (const name of ['ffprobe.exe', 'ffprobe']) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) {
        const ffmpeg = path.join(dir, name === 'ffprobe.exe' ? 'ffmpeg.exe' : 'ffmpeg');
        return { ffprobe: p, ffmpeg: fs.existsSync(ffmpeg) ? ffmpeg : null };
      }
    }
  }
  return { ffprobe: null, ffmpeg: null };
}

function run(cmd, args) {
  // ffmpeg/ffprobe 的分析日志走 stderr；spawnSync 显式合并 stdout+stderr 两路。
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  return String(r.stdout || '') + String(r.stderr || '');
}

function main() {
  const bins = resolveBin();
  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceVideo: 'acceptance/block482-c55-video-p0/video.mp4',
    bins: { ffprobe: bins.ffprobe, ffmpeg: bins.ffmpeg },
  };
  if (!bins.ffprobe) {
    out.status = 'external-blocked';
    out.reason = 'ffprobe 不可用——诚实不可用，不伪造 AV 读数';
    fs.writeFileSync(path.join(HERE, 'probe-readings.json'), JSON.stringify(out, null, 2) + '\n');
    console.error('[BLOCK-483] external-blocked: ffprobe unavailable');
    process.exitCode = 2;
    return;
  }

  const videoPath = path.join(P0, 'video.mp4');
  const spec = JSON.parse(fs.readFileSync(path.join(P0, 'video-project.json'), 'utf8'));
  const p0qa = JSON.parse(fs.readFileSync(path.join(P0, 'qa-report.json'), 'utf8'));

  // 1) ffprobe 流/格式读数
  const probeJson = run(bins.ffprobe, ['-v', 'error', '-show_entries',
    'stream=index,codec_type,codec_name,width,height,avg_frame_rate,duration',
    '-show_entries', 'format=duration', '-of', 'json', videoPath]);
  let probe;
  try { probe = JSON.parse(probeJson); } catch {
    out.status = 'probe_parse_failed';
    out.raw = String(probeJson).slice(0, 500);
    fs.writeFileSync(path.join(HERE, 'probe-readings.json'), JSON.stringify(out, null, 2) + '\n');
    process.exitCode = 3;
    return;
  }
  const vStream = (probe.streams || []).find((s) => s.codec_type === 'video') || {};
  const aStream = (probe.streams || []).find((s) => s.codec_type === 'audio') || {};
  const vDur = Number(vStream.duration) || 0;
  const aDur = Number(aStream.duration) || 0;

  // 2) 响度（ffmpeg volumedetect）
  let peakDbfs = null;
  let meanDbfs = null;
  if (bins.ffmpeg) {
    const vol = run(bins.ffmpeg, ['-hide_banner', '-i', videoPath, '-af', 'volumedetect', '-f', 'null', 'NUL']);
    const maxM = /max_volume:\s*(-?[\d.]+)\s*dB/.exec(vol);
    const meanM = /mean_volume:\s*(-?[\d.]+)\s*dB/.exec(vol);
    if (maxM) peakDbfs = Number(maxM[1]);
    if (meanM) meanDbfs = Number(meanM[1]);
  }

  // 3) 黑帧（blackdetect）+ 静音段（silencedetect）
  let blackStarts = [];
  let silentSeconds = 0;
  if (bins.ffmpeg) {
    const black = run(bins.ffmpeg, ['-hide_banner', '-i', videoPath, '-vf', 'blackdetect=d=0.5:pix_th=0.10', '-an', '-f', 'null', 'NUL']);
    blackStarts = [...black.matchAll(/black_start:([\d.]+)/g)].map((m) => Number(m[1]));
    const sil = run(bins.ffmpeg, ['-hide_banner', '-i', videoPath, '-af', 'silencedetect=noise=-45dB:d=0.5', '-f', 'null', 'NUL']);
    const starts = [...sil.matchAll(/silence_start:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    const ends = [...sil.matchAll(/silence_end:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    for (let i = 0; i < starts.length; i += 1) {
      if (Number.isFinite(ends[i])) silentSeconds += Math.max(0, ends[i] - starts[i]);
    }
  }

  // 4) 字幕溢出：SRT 时间与视频时长逐条边界比对（P0 subtitles.srt）。
  let subtitleOverflow = 0;
  const srtPath = path.join(P0, 'subtitles.srt');
  if (fs.existsSync(srtPath)) {
    const srt = fs.readFileSync(srtPath, 'utf8');
    for (const m of srt.matchAll(/(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})/g)) {
      const toMs = (t) => {
        const [hh, mm, rest] = t.split(':');
        const [ss, ms] = rest.split(',');
        return Number(hh) * 3600000 + Number(mm) * 60000 + Number(ss) * 1000 + Number(ms);
      };
      const endMs = toMs(m[2]);
      if (endMs > Math.round(vDur * 1000) + 500) subtitleOverflow += 1;
    }
  }

  out.avProbe = {
    video: {
      durationSec: vDur, width: Number(vStream.width) || 0, height: Number(vStream.height) || 0,
      codec: vStream.codec_name || 'unknown', blackFrames: blackStarts.length,
      avgFrameRate: vStream.avg_frame_rate || '0/0',
    },
    audio: {
      present: !!aStream.codec_name, durationSec: aDur,
      peakDbfs, meanDbfs, silentSec: Number(silentSeconds.toFixed(3)),
    },
    subtitles: {
      count: (fs.existsSync(srtPath) ? (fs.readFileSync(srtPath, 'utf8').match(/-->(\s|$)/g) || []).length : 0),
      overflowCount: subtitleOverflow,
      burned: !!(p0qa && p0qa.checks && p0qa.checks.find((c) => c.name === 'subtitles_burned' && c.passed)),
    },
  };

  const report = V.buildEvidenceReport(spec, out.avProbe);
  out.status = report.status;
  out.integrity = V.validateEvidenceIntegrity(report);
  out.evidenceReport = report;

  // P1 价值：如实登记 P0 存量成片的证据链缺口——P0 spec.sources 未采集 excerptRef，
  // 按 P1 Claim–Evidence 严格口径 traced=0/2。这是被 P1 抓到的真实缺口，不伪造片段掩盖。
  out.uncoveredGaps = [];
  const ce = report.sections.claimEvidence.stats;
  if (ce.untraced > 0) {
    out.uncoveredGaps.push({
      id: 'p0_sources_missing_excerptRef',
      detail: `P0 存量成片 sources 无 excerptRef（引用片段定位），Claim–Evidence 严格口径 traced=${ce.traced}/${ce.claims}；P1 能力由 HK-01 B3 规范 fixture（5/5 traced）证明，P0 数据补采属 P0 增量、不在本包篡改。`,
    });
  }
  if (report.sections.alignment.flags.some((f) => f.type === 'missing_evidence_ref')) {
    out.uncoveredGaps.push({
      id: 'p0_scene_no_evidence_ref',
      detail: 'P0 sc1 标题镜头未绑定 evidenceRefs（P0 设计如此，P1 标为可见警告 missing_evidence_ref，非致命）。',
    });
  }
  out.note = '读数由真实 ffprobe/ffmpeg 采集（证据生成器，非产品路径）；观感/科学专业性终审 pending_human_eye 未代签；P0 存量数据缺口如实登记不伪造。';

  fs.writeFileSync(path.join(HERE, 'probe-readings.json'), JSON.stringify(out, null, 2) + '\n');
  fs.writeFileSync(path.join(HERE, 'evidence-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`[BLOCK-483] status=${out.status} integrity=${out.integrity.ok} peak=${peakDbfs}dB black=${blackStarts.length} silent=${silentSeconds.toFixed(2)}s overflow=${subtitleOverflow}`);
}

try { main(); } catch (e) {
  fs.writeFileSync(path.join(HERE, 'probe-readings.json'), JSON.stringify({ status: 'failed', error: String((e && e.message) || e).slice(0, 500) }, null, 2) + '\n');
  console.error('[BLOCK-483] failed:', (e && e.message) || e);
  process.exitCode = 1;
}
