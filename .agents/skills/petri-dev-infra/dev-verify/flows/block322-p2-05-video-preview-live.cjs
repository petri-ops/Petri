#!/usr/bin/env node
'use strict';

/**
 * BLOCK-322 P2-05 实机腿：转盘视频在结果面真的能播。
 *
 * 判据不是「DOM 里有个 <video>」，而是 Chromium 把字节解成了媒体：
 * `readyState>=1` + `duration>0` + 解码出的真实分辨率，且面板读数行随之出现。
 * 另验三件容易静默失败的事：产物投影带工作区读面 URL（缺 url 必 404，UI-638 教训）、
 * 服务端 Content-Type 是 video/mp4（缺 MIME 时字节完好也播不动）、以及不自动播放。
 *
 * 运行前提：主 dev 栈 + 9223 测试实例在跑。证据落 acceptance/block-322-p2/。
 */

const path = require('node:path');
const fs = require('node:fs');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.BLOCK322_API || 'http://127.0.0.1:3001';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-322-p2');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function rest(method, endpoint, body, { timeoutMs = 240_000 } = {}) {
  const response = await fetch(`${API}/api${endpoint}`, {
    method,
    headers: { Authorization: 'Bearer desktop-local', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

async function fetchHeaders(urlPath) {
  const response = await fetch(`${API}${urlPath}`, {
    headers: { Authorization: 'Bearer desktop-local' },
    signal: AbortSignal.timeout(30_000),
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  return { status: response.status, contentType: response.headers.get('content-type') || '', bytes: buffer.length };
}

async function evalJs(client, expression, timeoutMs = 20_000) {
  let timer = null;
  try {
    return await Promise.race([
      lib.evalJs(client, expression),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cdp_eval_timeout')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function poll(fn, { timeoutMs, intervalMs = 1000, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 320)}`);
}

async function clickByText(client, text) {
  return evalJs(client, `(function(){
    const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(text)}));
    if (!btn) return 'not_found';
    btn.click();
    return 'clicked';
  })()`);
}

async function clickArtifact(client, name) {
  return evalJs(client, `(function(){
    const span = [...document.querySelectorAll('span')].find((e) => (e.textContent || '').trim() === ${JSON.stringify(name)});
    if (!span) return 'not_found';
    let node = span;
    for (let i = 0; i < 6 && node; i += 1) {
      if (node.tagName === 'BUTTON') { node.click(); return 'clicked'; }
      node = node.parentElement;
    }
    span.click();
    return 'clicked_span';
  })()`);
}

function box(id, position) {
  return {
    id,
    type: 'box',
    dimensions: { width: 120, height: 80, depth: 40 },
    transform: { position, rotation: [0, 0, 0] },
    material: { color: '#4c78a8', roughness: 0.45 },
  };
}

function sceneOf(title) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes: [box('base', [0, 0, 0]), box('tower', [0, 60, 60])],
    constraints: [],
    metadata: { title },
  };
}

const MEASURE = `(function(){
  var shell = document.querySelector('[data-testid="video-result-viewer"]');
  if (!shell) return JSON.stringify({ found: false });
  var v = shell.querySelector('video');
  var state = shell.querySelector('[data-testid="video-result-viewer-state"]');
  return JSON.stringify({
    found: true,
    hasVideo: !!v,
    src: v ? String(v.currentSrc || v.src || '') : '',
    readyState: v ? v.readyState : -1,
    networkState: v ? v.networkState : -1,
    mediaError: v && v.error ? (v.error.code + ':' + (v.error.message || '')) : null,
    canPlay: v ? v.canPlayType('video/mp4; codecs="avc1.42E01E"') : '',
    docHidden: document.hidden === true,
    duration: v ? v.duration : null,
    width: v ? v.videoWidth : 0,
    height: v ? v.videoHeight : 0,
    autoplay: v ? v.autoplay : null,
    controls: v ? v.controls : false,
    preload: v ? v.preload : '',
    stateText: state ? state.textContent : '',
    metaText: (shell.textContent || '').replace(/\\s+/g, ' '),
  });
})()`;

async function run(ctx) {
  const { assert } = ctx;
  const detail = {};
  let projectId = null;
  let client = null;
  try {
    const health = await rest('GET', '/health');
    assert('X0_backend_healthy', health.status === 200 && health.data?.status === 'ok', JSON.stringify(health.data ?? {}).slice(0, 120));
    const project = await rest('POST', '/data/projects', { name: `BLOCK322-P205-${Date.now()}` });
    projectId = project.data?.project?.id || project.data?.id || null;
    const workspacePath = project.data?.project?.workspace_path || '';
    assert('X1_temp_project', project.status === 200 && Boolean(projectId) && Boolean(workspacePath), JSON.stringify({ projectId }).slice(0, 120));

    const spun = await rest('POST', '/model3d/scene/export', {
      projectId,
      scene: sceneOf('P2-05 turntable'),
      scenePath: 'model3d/p205.scene3d.json',
      formats: ['glb'],
      turntable: { frames: 6, elevationDeg: 15 },
    });
    const studio = spun.data?.resultStudio || {};
    const turn = spun.data?.report?.turntable || {};
    const movieUnavailable = turn.movieCapability === 'unavailable';
    const mp4 = (spun.data?.outputs || []).find((item) => String(item.path).toLowerCase().endsWith('.mp4'));
    assert('X2_export_registered_with_video', spun.status === 200 && studio.registered === true && Boolean(studio.toolJobId)
      && (movieUnavailable
        ? !mp4 && turn.videoError === 'movie_format_unavailable' && (turn.stills || []).length > 0
        : Boolean(mp4) && fs.existsSync(path.join(workspacePath, mp4.path))),
      JSON.stringify({
        tier: movieUnavailable ? 'unavailable' : 'available',
        registered: studio.registered,
        toolJobId: studio.toolJobId,
        video: mp4?.path || null,
        videoError: turn.videoError ?? null,
      }).slice(0, 300));

    if (movieUnavailable) {
      // 本平台 Blender 无头出不了 mp4（macOS 5.2.3 实测 movie 格式被动态枚举摘除）：X3-X9 的
      // 播放判据都以 mp4 产物为前提，够不着就按无人化阶梯第 2 级如实收——不开窗凑证据、
      // 不伪造「视频能播」，也不像旧版那样在 mp4 缺席时抛 undefined.path 崩掉。
      assert('X2b_playback_leg_unreachable_on_this_platform', !mp4
        && (spun.data?.outputs || []).every((item) => !/\.mp4$/i.test(String(item.path)))
        && (turn.stills || []).length > 0,
        `tier=unavailable reason=${turn.videoError} frames=${(turn.stills || []).length}`
        + ' :: X3-X9 需 mp4 产物，本平台不可达（未验面如实登记，不以一代二）');
      detail.legOutcome = 'unavailable:movie_format_unavailable（播放面 X3-X9 不可达；序列帧面见 P2-04 腿）';
      fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
      fs.writeFileSync(path.join(EVIDENCE_DIR, 'block322-p2-05-video-preview-detail.json'), `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        platform: `${process.platform}-${process.arch}`,
        note: '本机 Blender 无头不支持 movie 输出 ⇒ 播放面不可达；本证据只登记缺席声明的诚实性，不含播放结论',
        ...detail,
      }, null, 2)}\n`, 'utf8');
      return true;
    }

    // —— 成果面投影：产物必须带工作区读面 URL 且 MIME 是视频（缺一项就是「有记录播不动」）——
    const status = await rest('GET', `/tools/status/${encodeURIComponent(studio.toolJobId)}`);
    const artifacts = status.data?.result?.artifacts || [];
    const videoName = path.basename(mp4.path);
    const videoArtifact = artifacts.find((item) => item.name === videoName) || null;
    assert('X3_video_artifact_projected_with_url', Boolean(videoArtifact)
      && String(videoArtifact.url || '').startsWith(`/api/workspaces/${projectId}/file?path=`),
      JSON.stringify({ names: artifacts.map((item) => item.name), url: videoArtifact?.url || null }).slice(0, 320));
    const served = await fetchHeaders(videoArtifact.url);
    assert('X4_served_as_video_mime', served.status === 200 && served.contentType === 'video/mp4' && served.bytes > 1000,
      JSON.stringify(served).slice(0, 200));

    // —— UI：真实点击链打开视频产物 ——
    client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await evalJs(client, `location.href = ${JSON.stringify(`${APP}/project/${projectId}/result`)}, 'nav'`).catch(() => null);
    await poll(async () => (await evalJs(client, `(function(){
      const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').replace(/\\s+/g, ' ').includes('model3d_export'));
      return btn ? 1 : null;
    })()`).catch(() => null)) ? true : null, { timeoutMs: 45_000, label: 'job_card' });
    const jobClicked = await clickByText(client, 'model3d_export');
    assert('X5_job_card_clicked', jobClicked === 'clicked', String(jobClicked));
    await sleep(2500);
    const clicked = await clickArtifact(client, videoName);
    assert('X6_video_artifact_selected', clicked !== 'not_found', String(clicked));

    // 挂载判据要等到 <video> 真的在场：字节是先 fetch 再挂 blob: 源，
    // 只等 viewer 外壳会把「还没取到字节」的瞬间当成已挂载（实机首跑即为此红）。
    const mounted = await poll(async () => {
      const raw = JSON.parse(await evalJs(client, MEASURE).catch(() => '{"found":false}'));
      return raw.found && raw.hasVideo ? raw : null;
    }, { timeoutMs: 40_000, label: 'video_element_mounted' });
    assert('X7_video_viewer_mounted_no_autoplay', mounted.hasVideo === true && mounted.controls === true
      && mounted.autoplay === false && mounted.preload === 'metadata' && /^blob:/.test(mounted.src)
      && mounted.docHidden === false,
      JSON.stringify({ hasVideo: mounted.hasVideo, controls: mounted.controls, autoplay: mounted.autoplay, preload: mounted.preload, src: mounted.src.slice(0, 24), docHidden: mounted.docHidden }).slice(0, 260));

    // 解码判据失败时要把最后一次真实媒体状态带进证据（readyState/networkState/error/canPlayType），
    // 否则「没播起来」只有一句 timeout，归因不了是环境、MIME 还是解码支持。
    let lastMeasure = null;
    let decoded = null;
    try {
      decoded = await poll(async () => {
        lastMeasure = JSON.parse(await evalJs(client, MEASURE).catch(() => '{}'));
        return lastMeasure.readyState >= 1 && Number.isFinite(lastMeasure.duration) && lastMeasure.duration > 0
          ? lastMeasure : null;
      }, { timeoutMs: 45_000, intervalMs: 1000, label: 'video_decoded' });
    } catch (error) {
      assert('X8_chromium_actually_decoded_the_media', false,
        `${error.message} :: last=${JSON.stringify(lastMeasure).slice(0, 420)}`);
    }
    if (decoded) {
    assert('X8_chromium_actually_decoded_the_media', decoded.readyState >= 1 && decoded.duration > 0
      && decoded.width === 800 && decoded.height === 600,
      JSON.stringify({ readyState: decoded.readyState, duration: decoded.duration, width: decoded.width, height: decoded.height }).slice(0, 220));
    assert('X9_readout_visible_and_no_failure_state', decoded.metaText.includes('时长')
      && decoded.metaText.includes('800×600') && !decoded.stateText.includes('不可用'),
      JSON.stringify({ stateText: decoded.stateText, meta: decoded.metaText.slice(0, 220) }).slice(0, 420));
    }

    detail.video = { name: videoName, url: videoArtifact.url, served, registered: { toolJobId: studio.toolJobId } };
    detail.playback = decoded || lastMeasure;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block322-p2-05-video-preview-detail.json'), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      note: '播放判据=Chromium 解出 duration 与真实分辨率（800×600），不是 DOM 里存在 <video>',
      ...detail,
    }, null, 2)}\n`, 'utf8');
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* already closed */ }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'block322-p2-05-video-preview-live',
  description: 'BLOCK-322 P2-05：结果面打开转盘 mp4 真能播（产物投影带工作区 URL + video/mp4 MIME + Chromium 解出时长/分辨率 + 不自动播 + 失败态不在场）',
  evidenceDir: EVIDENCE_DIR,
  run,
};
