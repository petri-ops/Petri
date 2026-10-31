#!/usr/bin/env node
'use strict';

/**
 * BLOCK-322 P2-04 实机腿：转盘真的出序列帧 + mp4，且登记的是目录里实测存在的文件。
 *
 * 三条不妥协的判据：
 * ①**产物存在性由磁盘复核**：视频/帧的 bytes 与 sha256 都在本腿里按工作区路径重算一遍，
 *    与 provider 登记值对照——「报告里有路径」不等于「文件真在那儿」。
 * ②**是 mp4 而不是改名 PNG**：读文件头验 ISO-BMIF（偏移 4 起为 `ftyp`）。
 * ③**存量零变化**：未请求 turntable 时不产出视频、不额外渲染（老场景耗时不变），
 *    请求越界时在探 Blender 之前就拒（不白付一次执行成本）。
 *
 * 运行前提：主 dev 栈 + 测试实例在跑（core 改动需先重启 dev 栈）。证据落 acceptance/block-322-p2/。
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const API = process.env.BLOCK322_API || 'http://127.0.0.1:3001';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-322-p2');

async function rest(method, endpoint, body, { timeoutMs = 240_000 } = {}) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: { Authorization: 'Bearer desktop-local', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

function box(id, position, color) {
  return {
    id,
    type: 'box',
    dimensions: { width: 120, height: 80, depth: 40 },
    transform: { position, rotation: [0, 0, 0] },
    material: { color, roughness: 0.4 },
  };
}

function sceneOf(title) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes: [box('base', [0, 0, 0], '#4c78a8'), box('tower', [0, 60, 60], '#d29b42')],
    constraints: [],
    metadata: { title },
  };
}

const sha256Of = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

async function run(ctx) {
  const { assert } = ctx;
  const detail = {};
  let projectId = null;
  try {
    const capability = await rest('GET', '/model3d/capability');
    assert('V0_blender_ready', capability.status === 200 && capability.data?.status === 'ready',
      JSON.stringify(capability.data ?? {}).slice(0, 140));
    const project = await rest('POST', '/data/projects', { name: `BLOCK322-P204-${Date.now()}` });
    projectId = project.data?.project?.id || project.data?.id || null;
    let workspacePath = project.data?.project?.workspace_path || project.data?.workspace_path || null;
    if (!workspacePath && projectId) {
      const listed = await rest('GET', '/data/projects');
      const rows = Array.isArray(listed.data?.projects) ? listed.data.projects : (Array.isArray(listed.data) ? listed.data : []);
      workspacePath = (rows.find((row) => row.id === projectId) || {}).workspace_path || null;
    }
    assert('V1_temp_project_with_workspace', project.status === 200 && Boolean(projectId) && Boolean(workspacePath),
      JSON.stringify({ projectId }).slice(0, 120));

    // —— V2：越界请求在探 Blender 之前就被拒（不白付执行成本）——
    const tooMany = await rest('POST', '/model3d/scene/export', {
      projectId,
      scene: sceneOf('P2-04 invalid frames'),
      scenePath: 'model3d/p204-invalid.scene3d.json',
      formats: [],
      turntable: { frames: 49 },
    });
    assert('V2_out_of_bounds_rejected_before_execution', tooMany.status === 400
      && String(tooMany.data?.error || '').includes('turntable_frames_invalid'),
      JSON.stringify(tooMany.data ?? {}).slice(0, 240));

    // —— V3：未请求转盘 ⇒ 无视频、requested=0（存量行为零变化）——
    const plain = await rest('POST', '/model3d/scene/export', {
      projectId,
      scene: sceneOf('P2-04 plain'),
      scenePath: 'model3d/p204-plain.scene3d.json',
      formats: ['glb'],
    });
    const plainReport = plain.data?.report || {};
    assert('V3_absent_turntable_is_noop', plain.status === 200 && plainReport.ok === true
      && (plainReport.turntable?.requested || 0) === 0
      && plainReport.turntable?.video == null
      && (plainReport.turntable?.stills || []).length === 0
      && !(plain.data?.outputs || []).some((item) => String(item.path).toLowerCase().endsWith('.mp4')),
      JSON.stringify({ turntable: plainReport.turntable, outputs: (plain.data?.outputs || []).map((item) => path.basename(item.path)) }).slice(0, 300));

    // —— V4-V8：真跑一遍转盘 ——
    const spun = await rest('POST', '/model3d/scene/export', {
      projectId,
      scene: sceneOf('P2-04 turntable'),
      scenePath: 'model3d/p204-spin.scene3d.json',
      formats: ['glb'],
      turntable: { frames: 8, elevationDeg: 18 },
    });
    const spunReport = spun.data?.report || {};
    const turn = spunReport.turntable || {};
    // 平台能力分档（macOS 复验实测）：Blender 5.2.3 无头不放行 movie 格式，4.5.10 win32 放行。
    // unavailable 档的判据换成「缺席有没有被诚实声明」，不硬要一个本平台出不了的 mp4；
    // available 档维持原判据。两档都必须把已出盘的序列帧拿住（连坐丢弃是缺陷，不是平台差异）。
    const movieTier = turn.movieCapability === 'unavailable' ? 'unavailable' : 'available';
    const movieDeclaredAbsent = turn.video == null && turn.videoError === 'movie_format_unavailable'
      && (turn.stills || []).length === 8;
    assert('V4_turntable_built_and_report_ok', spun.status === 200 && spun.data?.ok === true && spunReport.ok === true
      && turn.requested === 8 && turn.frames === 8 && (turn.errors || []).length === 0
      && turn.elevationDeg === 18 && turn.fps === 12
      && (movieTier === 'available' ? typeof turn.video === 'string' : movieDeclaredAbsent),
      JSON.stringify({
        tier: movieTier,
        videoError: turn.videoError ?? null,
        ok: spunReport.ok,
        turn: { ...turn, stills: (turn.stills || []).length },
      }).slice(0, 420));

    const videoRegistered = (spun.data?.outputs || []).find((item) => String(item.path).toLowerCase().endsWith('.mp4'));
    const videoAbsolute = videoRegistered ? path.join(workspacePath, videoRegistered.path) : null;
    assert('V5_video_exists_and_registered_hash_matches_disk', movieTier === 'unavailable'
      ? !videoRegistered && movieDeclaredAbsent
      : Boolean(videoRegistered)
      && fs.existsSync(videoAbsolute)
      && videoRegistered.sha256 === sha256Of(videoAbsolute)
      && videoRegistered.bytes === fs.statSync(videoAbsolute).size
      && videoRegistered.bytes > 1000
      && path.basename(String(turn.video || '')) === path.basename(videoRegistered.path),
      JSON.stringify({
        tier: movieTier,
        registered: videoRegistered ? { ...videoRegistered, sha256: `${videoRegistered.sha256.slice(0, 12)}…` } : null,
        reportVideo: turn.video,
        videoError: turn.videoError ?? null,
      }).slice(0, 320));

    const strayMp4 = spun.data?.outDir && fs.existsSync(path.join(workspacePath, spun.data.outDir))
      ? fs.readdirSync(path.join(workspacePath, spun.data.outDir)).filter((name) => /\.mp4$/i.test(name))
      : [];
    const header = videoAbsolute ? fs.readFileSync(videoAbsolute).subarray(0, 12) : Buffer.alloc(0);
    assert('V6_payload_is_real_mp4_not_renamed_image', movieTier === 'unavailable'
      ? strayMp4.length === 0
      : header.toString('ascii', 4, 8) === 'ftyp',
      `tier=${movieTier} header=${JSON.stringify(header.toString('hex').slice(0, 24))} stray=${JSON.stringify(strayMp4)}`);

    const frameAssets = spun.data?.frameAssets || [];
    const stillChecks = frameAssets.map((item) => {
      const absolute = path.join(workspacePath, item.path);
      return {
        name: path.basename(absolute),
        exists: fs.existsSync(absolute),
        bytes: fs.existsSync(absolute) ? fs.statSync(absolute).size : 0,
        shaMatches: fs.existsSync(absolute) && item.sha256 === sha256Of(absolute),
      };
    });
    assert('V7_frame_sequence_real_and_auditable', stillChecks.length === 8
      && stillChecks.every((row) => row.exists && row.bytes > 1000 && row.shaMatches),
      JSON.stringify(stillChecks).slice(0, 420));
    assert('V8_stills_do_not_flood_result_surface', (spun.data?.outputs || []).filter((item) => /\.mp4$/i.test(item.path)).length
      === (movieTier === 'available' ? 1 : 0)
      && (spun.data?.outputs || []).every((item) => !/turntable-frame/i.test(item.path))
      && frameAssets.length === 8,
      JSON.stringify({
        tier: movieTier,
        outputs: (spun.data?.outputs || []).map((item) => path.basename(item.path)),
        frames: frameAssets.length,
      }).slice(0, 380));

    // —— V9：匀速转动的可复核证据：相邻帧画面确实不同（同一帧重复 = 相机没动）——
    const distinct = frameAssets.map((item) => sha256Of(path.join(workspacePath, item.path)).slice(0, 16));
    assert('V9_frames_differ_camera_actually_rolled', distinct.length === 8
      && new Set(distinct).size === distinct.length,
      JSON.stringify({ unique: new Set(distinct).size, total: distinct.length }).slice(0, 200) + '（空列表不得算通过）');
    detail.frameHashes = distinct;
    detail.durationMs = { plain: plain.data?.durationMs ?? null, spun: spun.data?.durationMs ?? null };
    assert('V10_double_render_cost_visible_and_bounded', typeof spun.data?.durationMs === 'number'
      && spun.data.durationMs > 0 && spun.data.durationMs < 170_000,
      JSON.stringify(detail.durationMs).slice(0, 200) + '（两次渲染路线的代价必须可见，且留在 180s 超时之内）');

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block322-p2-04-turntable-detail.json'), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      capability: capability.data,
      movieTier,
      videoError: turn.videoError ?? null,
      video: videoRegistered,
      frameAssets: spun.data?.frameAssets || [],
      stillChecks,
      durationMs: detail.durationMs,
      reportTurntable: turn,
      display: spunReport.display,
      boundsMm: spunReport.boundsMm,
    }, null, 2)}\n`, 'utf8');
    return true;
  } finally {
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'block322-p2-04-turntable-live',
  description: 'BLOCK-322 P2-04：转盘序列帧 + mp4 实机（磁盘复算 sha/bytes、mp4 文件头验真、逐帧哈希证明相机真的在转、未请求零变化、越界先拒）',
  evidenceDir: EVIDENCE_DIR,
  run,
};
