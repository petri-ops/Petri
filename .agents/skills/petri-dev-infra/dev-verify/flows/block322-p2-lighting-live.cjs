#!/usr/bin/env node
'use strict';

/**
 * BLOCK-322 P2-02 实机腿：灯光与环境（引擎切换 + 真实照明 + 预览侧同声明）。
 *
 * 证据强度设计：不只看参数回显——用**可解码像素的平均亮度**做单调对照，
 * 证明「声明的灯真的参与成像」，而不是被静默忽略：
 *   C1 无灯无环境 → display.engine = BLENDER_WORKBENCH（存量行为与耗时不变）
 *   C2 声明灯/环境 → 切 CYCLES(CPU)，回显 lights.created / environment 生效值
 *   C3 同场景 world=0 + sun energy 0 vs sun energy 900 → 平均亮度必须单调上升（暗→亮）
 *   C4 非单调（亮度不随能量变化）即为缺陷：断言 fail
 *   C5 预览端（9223 离屏）：同一 SceneSpec 载入两次（0 能量 / 900 能量），
 *      画布像素平均亮度同样单调上升 ⇒ 两侧都真的在按声明照明
 *   C6 非法灯种在 REST 层 fail-closed（不静默丢灯）
 *
 * 运行前提：主 dev 栈 + 测试实例已启动。证据落 acceptance/block-322-p2/。
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const zlib = require('node:zlib');
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

async function evalJs(client, expression, timeoutMs = 25_000) {
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

async function poll(fn, { timeoutMs, intervalMs = 500, label }) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 300)}`);
}

/** 纯 Node 解 8bit 非隔行 PNG 的平均亮度（Blender 与 WebGL toDataURL 都是这一形制）。 */
function pngMeanLuminance(buffer) {
  if (buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('not_png');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      if (data[12] !== 0) throw new Error('interlaced_unsupported');
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (bitDepth !== 8 || ![0, 2, 4, 6].includes(colorType)) throw new Error(`unsupported_png_depth_or_color(depth=${bitDepth},color=${colorType})`);
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);
  let previous = Buffer.alloc(stride);
  let cursor = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[cursor];
    cursor += 1;
    const line = Buffer.from(raw.subarray(cursor, cursor + stride));
    cursor += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value = (value + left) & 0xff;
      else if (filter === 2) value = (value + up) & 0xff;
      else if (filter === 3) value = (value + ((left + up) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        const predictor = (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
        value = (value + predictor) & 0xff;
      }
      line[x] = value;
    }
    line.copy(out, y * stride);
    previous = line;
  }
  let sum = 0;
  let samples = 0;
  for (let i = 0; i < out.length; i += channels) {
    if (channels === 1) { sum += out[i]; samples += 1; continue; }
    sum += 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
    samples += 1;
  }
  return { mean: samples ? sum / samples : 0, width, height, samples };
}

function boxScene(extra = {}) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes: [{
      id: 'base',
      type: 'box',
      dimensions: { width: 120, depth: 80, height: 40 },
      transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
      material: { color: '#b8c4d0', roughness: 0.35 },
    }],
    constraints: [],
    metadata: { title: 'BLOCK-322 P2-02 live' },
    ...extra,
  };
}

const sunLight = (energy) => [{ id: 'key', kind: 'sun', energy, color: '#ffffff', position: [260, -320, 420], target: [0, 0, 20] }];
const DARK_WORLD = { background: '#000000', worldStrength: 0, samples: 16, engine: 'cycles' };

const canvasLumExpr = `(async function(){
  var panel = document.querySelector('[data-testid="model3d-surface"]');
  if (!panel) return JSON.stringify({ ok: false, why: 'no-panel' });
  var canvas = panel.querySelector('[data-testid="model3d-canvas"]');
  if (!canvas) return JSON.stringify({ ok: false, why: 'no-canvas' });
  var url = '';
  try { url = canvas.toDataURL('image/png'); } catch (e) { return JSON.stringify({ ok: false, why: 'todataurl:' + e.message }); }
  var img = new Image();
  img.src = url;
  await new Promise(function(res, rej){ img.onload = res; img.onerror = function(){ rej(new Error('decode')); }; });
  var w = Math.min(160, img.naturalWidth || 160), h = Math.min(120, img.naturalHeight || 120);
  var tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
  var ctx = tmp.getContext('2d');
  ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, 0, 0, w, h);
  var data = ctx.getImageData(0, 0, w, h).data;
  var sum = 0, n = 0;
  for (var i = 0; i < data.length; i += 4) { sum += 0.2126*data[i] + 0.7152*data[i+1] + 0.0722*data[i+2]; n += 1; }
  var alert = panel.querySelector('[role="alert"]');
  return JSON.stringify({ ok: true, mean: n ? sum / n : 0, w: w, h: h, hash: url.slice(-40), alert: alert ? (alert.textContent || '') : '' });
})()`;

async function setFileOnInput(client, selector, absolutePath) {
  await client.send('DOM.enable');
  const document = await client.send('DOM.getDocument', { depth: -1 });
  const found = await client.send('DOM.querySelector', { nodeId: document.root.nodeId, selector });
  if (!found || !found.nodeId) throw new Error(`input_not_found: ${selector}`);
  await client.send('DOM.setFileInputFiles', { nodeId: found.nodeId, files: [absolutePath] });
}

async function run(ctx) {
  const { assert } = ctx;
  const detail = {};
  let projectId = null;
  let client = null;
  const tempFiles = [];
  try {
    const capability = await rest('GET', '/model3d/capability');
    assert('C0_blender_ready', capability.status === 200 && capability.data?.status === 'ready',
      JSON.stringify(capability.data ?? {}).slice(0, 160));

    const project = await rest('POST', '/data/projects', { name: `BLOCK322-P2L-${Date.now()}` });
    projectId = project.data?.project?.id || project.data?.id || null;
    assert('C1_temp_project', project.status === 200 && Boolean(projectId), JSON.stringify({ projectId }).slice(0, 120));

    // C2 未声明灯光/环境 → 仍是 Workbench（存量行为不变）
    const plain = await rest('POST', '/model3d/scene/export', {
      projectId, scene: boxScene({ render: { width: 640, height: 480 } }), scenePath: 'model3d/plain.scene3d.json', formats: [],
    });
    const plainDisplay = plain.data?.report?.display || {};
    assert('C2_undeclared_keeps_workbench', plain.status === 200 && plain.data?.ok === true
      && plainDisplay.engine === 'BLENDER_WORKBENCH' && plainDisplay.declaredLighting === false
      && (plain.data?.report?.lights?.created || []).length === 0,
      JSON.stringify(plainDisplay).slice(0, 200));

    // C3 声明灯/环境 → 切 Cycles 并回显
    const lit = await rest('POST', '/model3d/scene/export', {
      projectId,
      scene: boxScene({ lights: sunLight(900), environment: DARK_WORLD, camera: { position: [260, -320, 420], target: [0, 0, 20], fovDeg: 40 }, render: { width: 640, height: 480 } }),
      scenePath: 'model3d/lit.scene3d.json',
      formats: [],
    });
    const litReport = lit.data?.report || {};
    assert('C3_declared_switches_to_cycles', lit.status === 200 && lit.data?.ok === true
      && litReport.display?.engine === 'CYCLES' && litReport.display?.declaredLighting === true
      && litReport.display?.samples === 16 && litReport.display?.device === 'CPU',
      JSON.stringify(litReport.display ?? {}).slice(0, 240));
    assert('C3b_lights_and_world_echoed', (litReport.lights?.created || []).length === 1
      && litReport.lights.created[0].kind === 'SUN' && Math.abs(litReport.lights.created[0].energy - 900) < 1e-6
      && litReport.environment?.declared === true && litReport.environment?.effectiveWorldStrength === 0
      && Math.abs((litReport.environment?.effectiveColor || [0, 0, 0]).reduce((a, b) => a + b, 0)) < 1e-6,
      JSON.stringify({ lights: litReport.lights, environment: litReport.environment }).slice(0, 300));

    // C4/C5 亮度单调对照：同场景 0 能量 vs 900 能量（world=0 排除环境光干扰）
    const dark = await rest('POST', '/model3d/scene/export', {
      projectId,
      scene: boxScene({ lights: sunLight(0), environment: DARK_WORLD, camera: { position: [260, -320, 420], target: [0, 0, 20], fovDeg: 40 }, render: { width: 640, height: 480 } }),
      scenePath: 'model3d/dark.scene3d.json',
      formats: [],
    });
    const darkPath = dark.data?.report?.renders?.camera;
    const litPath = litReport.renders?.camera;
    assert('C4_both_renders_exist', Boolean(darkPath) && fs.existsSync(darkPath) && Boolean(litPath) && fs.existsSync(litPath),
      JSON.stringify({ darkPath: Boolean(darkPath), litPath: Boolean(litPath) }));
    const darkLum = pngMeanLuminance(fs.readFileSync(darkPath));
    const litLum = pngMeanLuminance(fs.readFileSync(litPath));
    assert('C5_sun_energy_raises_luminance', darkLum.mean < 8 && litLum.mean > darkLum.mean * 2,
      JSON.stringify({ darkMean: +darkLum.mean.toFixed(2), litMean: +litLum.mean.toFixed(2), size: litLum.width }));
    detail.luminance = {
      engineDark: dark.data?.report?.display?.engine,
      darkMean: +darkLum.mean.toFixed(3),
      litMean: +litLum.mean.toFixed(3),
      samples: litLum.samples,
    };

    // C6 非法灯种在 REST 层拒收（不静默丢灯）
    const badLight = await rest('POST', '/model3d/scene/export', {
      projectId, scene: boxScene({ lights: [{ id: 'x', kind: 'laser', energy: 5, position: [0, 0, 10] }] }), formats: [],
    });
    assert('C6_unknown_light_kind_rejected', badLight.status === 400
      && (badLight.data?.errors || []).some((error) => String(error).includes('kind 只支持 sun/point/spot/area')),
      JSON.stringify(badLight.data ?? {}).slice(0, 220));

    // UI 线：预览端同声明照明（不只看参数回显）
    client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await evalJs(client, `(function(){
      localStorage.setItem('petri.workSurfaceTabs.v1.' + ${JSON.stringify(projectId)},
        JSON.stringify({ version: 1, tabs: [{ id: 'model3d', surfaceId: 'model3d' }], activeId: 'model3d' }));
      location.href = ${JSON.stringify(`${APP}/project/`)} + ${JSON.stringify(projectId)};
      return 'go';
    })()`);
    await poll(async () => {
      const pathname = await evalJs(client, 'location.pathname').catch(() => '');
      return pathname === `/project/${projectId}` ? pathname : null;
    }, { timeoutMs: 30_000, label: 'project_route' });
    await evalJs(client, `(function(){
      var btns = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < btns.length; i += 1) {
        var text = (btns[i].textContent || '').trim();
        if (text === '开始使用' || text === '知道了' || text === '3D 模型') btns[i].click();
      }
      return 'ok';
    })()`).catch(() => null);
    await poll(async () => (await evalJs(client, `!!document.querySelector('[data-testid="model3d-surface"]')`).catch(() => false)) === true
      ? true : null, { timeoutMs: 30_000, label: 'model3d_surface' });

    async function previewLuminance(sceneSpec, tag, beforeHash) {
      const file = path.join(os.tmpdir(), `block322-p2-light-${tag}-${Date.now()}.scene3d.json`);
      fs.writeFileSync(file, JSON.stringify(sceneSpec, null, 2), 'utf8');
      tempFiles.push(file);
      await setFileOnInput(client, '[data-testid="model3d-file-input"]', file);
      // 必须等到「新帧」再读数：canvas 在场景变更前仍保留上一帧，
      // 只要求 mean>0 会把残影当成证据（本腿首跑即因此两条读数相同）。
      const sample = await poll(async () => {
        const parsed = JSON.parse(await evalJs(client, canvasLumExpr).catch(() => '{}'));
        return parsed.ok === true && (!beforeHash || parsed.hash !== beforeHash) ? parsed : null;
      }, { timeoutMs: 20_000, intervalMs: 400, label: `preview_new_frame_${tag}` });
      return { mean: sample.mean, alert: sample.alert, hash: sample.hash };
    }

    const initial = JSON.parse(await evalJs(client, canvasLumExpr).catch(() => '{}'));
    const previewDark = await previewLuminance(boxScene({ lights: sunLight(0), environment: DARK_WORLD }), 'dark', initial.ok ? initial.hash : null);
    const previewLit = await previewLuminance(boxScene({ lights: sunLight(900), environment: DARK_WORLD }), 'lit', previewDark.hash);
    assert('U1_preview_lights_actually_light_the_scene', previewLit.mean > previewDark.mean * 1.2
      && previewDark.alert === '' && previewLit.alert === '',
      JSON.stringify({ darkMean: +previewDark.mean.toFixed(2), litMean: +previewLit.mean.toFixed(2) }).slice(0, 240));
    detail.preview = { darkMean: +previewDark.mean.toFixed(3), litMean: +previewLit.mean.toFixed(3) };

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block322-p2-lighting-detail.json'), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      capability: capability.data,
      display: { plain: plainDisplay, lit: litReport.display },
      lightsEcho: litReport.lights,
      environmentEcho: litReport.environment,
      ...detail,
    }, null, 2)}\n`, 'utf8');
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* already closed */ }
    for (const file of tempFiles) { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'block322-p2-lighting-live',
  description: 'BLOCK-322 P2-02：声明灯光/环境真参与成像（引擎切换 + 亮度单调对照 + 预览侧同声明）',
  evidenceDir: EVIDENCE_DIR,
  run,
};
