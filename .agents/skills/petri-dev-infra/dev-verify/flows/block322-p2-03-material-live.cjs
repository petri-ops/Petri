#!/usr/bin/env node
'use strict';

/**
 * BLOCK-322 P2-03 实机腿：PBR 材质与贴图真的进成像，且 sha 篡改不静默放行。
 *
 * 两条硬判据（都是可数值断言，不看观感）：
 * ①**像素单调对照**：同一场景、同一环境光（两侧都声明 ⇒ 都走 Cycles，避免引擎不同污染对照），
 *   基础色贴图换成纯红后 front.png 的 R 通道显著上升、B 通道显著下降——贴图不是「声明了但没上树」。
 * ②**引擎按声明切换**：只声明 metallic/emissive/贴图（没有灯）时也必须切 Cycles，
 *   否则 Workbench 的 MATERIAL 着色根本不认这些字段，又是一类「加了但看不见」的静默失真。
 * 另外验 sha256 逐字节复验（篡改即拒且同场景其余基本体照常构建）与预览端诚实失败。
 *
 * 运行前提：主 dev 栈 + 9223 测试实例在跑。证据落 acceptance/block-322-p2/。
 */

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const lib = require('../lib.cjs');

const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.BLOCK322_API || 'http://127.0.0.1:3001';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-322-p2');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function crc32(buffer) {
  let { table } = crc32;
  if (!table) {
    table = crc32.table = Array.from({ length: 256 }, (_, index) => {
      let value = index;
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
      return value >>> 0;
    });
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * 纯红贴图：本腿自带最小编码器生成，随后用**同一个解码器读回自检**（T2a）。
 * 不手写 base64 素材——编码写错就当当场红，而不是拿一张假图当「贴图生效」的证据。
 */
function solidRedPng(size = 4) {
  const zlib = require('node:zlib');
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  const rows = [];
  for (let y = 0; y < size; y += 1) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) row[1 + x * 3] = 255;
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const RED_PNG = solidRedPng();

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

async function setFileOnInput(client, selector, absolutePath) {
  await client.send('DOM.enable');
  const document = await client.send('DOM.getDocument', { depth: -1 });
  const found = await client.send('DOM.querySelector', { nodeId: document.root.nodeId, selector });
  if (!found || !found.nodeId) throw new Error(`input_not_found: ${selector}`);
  await client.send('DOM.setFileInputFiles', { nodeId: found.nodeId, files: [absolutePath] });
}

function box(id, position, material) {
  return {
    id,
    type: 'box',
    dimensions: { width: 120, height: 80, depth: 40 },
    transform: { position, rotation: [0, 0, 0] },
    material,
  };
}

// 两侧都声明环境光 ⇒ 都切 Cycles（引擎一致，像素对照才干净）；
// 世界色用纯白：Cycles 下世界就是唯一光源，暗色背景会让整幅接近全黑（首跑实测均值 8.5），
// 届时「贴图让图变红」的信号会被压到阈值以下——那是夹具设计问题，不是产品问题。
function sceneOf(nodes, title) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes,
    constraints: [],
    environment: { background: '#ffffff', worldStrength: 1, samples: 16 },
    metadata: { title },
  };
}

const FLAT_BLUE = { color: '#4c78a8', roughness: 0.5 };
const sha = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function run(ctx) {
  const { assert } = ctx;
  const detail = {};
  let projectId = null;
  let client = null;
  const tempFiles = [];
  let textureOnDisk = null;
  try {
    const capability = await rest('GET', '/model3d/capability');
    assert('T0_blender_ready', capability.status === 200 && capability.data?.status === 'ready',
      JSON.stringify(capability.data ?? {}).slice(0, 140));
    const project = await rest('POST', '/data/projects', { name: `BLOCK322-P203-${Date.now()}` });
    projectId = project.data?.project?.id || project.data?.id || null;
    let workspacePath = project.data?.project?.workspace_path || project.data?.workspace_path || null;
    if (!workspacePath && projectId) {
      const listed = await rest('GET', '/data/projects');
      const rows = Array.isArray(listed.data?.projects) ? listed.data.projects : (Array.isArray(listed.data) ? listed.data : []);
      workspacePath = (rows.find((row) => row.id === projectId) || {}).workspace_path || null;
    }
    assert('T1_temp_project_with_workspace', project.status === 200 && Boolean(projectId) && Boolean(workspacePath),
      JSON.stringify({ projectId, workspacePath }).slice(0, 200));

    // —— T2-T4：贴图预检（真实盘面算 sha；格式/缺失按贴图语义拒）——
    const fixture = lib.pngPixelStats(RED_PNG);
    assert('T2a_texture_fixture_roundtrip', fixture.r > 250 && fixture.g < 5 && fixture.b < 5 && fixture.samples === 16,
      JSON.stringify(fixture).slice(0, 200) + '（自编码贴图必须被同一解码器读回为纯红）');
    textureOnDisk = path.join(workspacePath, 'model3d', 'textures', 'panel.png');
    fs.mkdirSync(path.dirname(textureOnDisk), { recursive: true });
    fs.writeFileSync(textureOnDisk, RED_PNG);
    const inspect = await rest('POST', '/model3d/texture/inspect', { projectId, path: 'model3d/textures/panel.png' });
    assert('T2_texture_inspect_real_sha', inspect.status === 200 && inspect.data?.ok === true
      && inspect.data?.format === 'png'
      && inspect.data?.sourceSha256 === sha(RED_PNG)
      && inspect.data?.bytes === RED_PNG.length
      && inspect.data?.maxBytes === 16 * 1024 * 1024,
      JSON.stringify(inspect.data ?? {}).slice(0, 240));

    fs.writeFileSync(path.join(workspacePath, 'model3d', 'textures', 'logo.svg'), '<svg xmlns="x"/>', 'utf8');
    const unsupported = await rest('POST', '/model3d/texture/inspect', { projectId, path: 'model3d/textures/logo.svg' });
    assert('T3_texture_format_rejected', unsupported.status === 400 && unsupported.data?.error === 'texture_format_unsupported',
      JSON.stringify(unsupported.data ?? {}).slice(0, 200));

    const missing = await rest('POST', '/model3d/texture/inspect', { projectId, path: 'model3d/textures/gone.png' });
    assert('T4_texture_not_found_status', missing.status === 404 && missing.data?.error === 'texture_not_found',
      JSON.stringify({ status: missing.status, data: missing.data }).slice(0, 200));

    // —— T5/T6：构建侧真的用上贴图（报告回显 + 像素单调对照）——
    const textureSpec = { path: 'model3d/textures/panel.png', sourceSha256: sha(RED_PNG) };
    const plain = await rest('POST', '/model3d/scene/export', {
      projectId,
      scene: sceneOf([box('panel', [0, 0, 0], FLAT_BLUE)], 'P2-03 plain'),
      scenePath: 'model3d/p203-plain.scene3d.json',
      formats: ['glb'],
    });
    const textured = await rest('POST', '/model3d/scene/export', {
      projectId,
      scene: sceneOf([box('panel', [0, 0, 0], { ...FLAT_BLUE, metallic: 0.6, emissive: '#061018', baseColorTexture: textureSpec })], 'P2-03 textured'),
      scenePath: 'model3d/p203-textured.scene3d.json',
      formats: ['glb'],
    });
    const plainReport = plain.data?.report || {};
    const texturedReport = textured.data?.report || {};
    assert('T5_build_accepts_pbr_and_declares_cycles', textured.status === 200 && texturedReport.ok === true
      && texturedReport.display?.engine === 'CYCLES'
      && texturedReport.display?.declaredMaterial === true
      && (texturedReport.materials?.declared || []).some((row) => row.id === 'panel'
        && row.metallic === 0.6 && row.emissive === '#061018' && row.baseColorTexture === 'model3d/textures/panel.png'),
      JSON.stringify({ engine: texturedReport.display, materials: texturedReport.materials, unsupported: texturedReport.unsupported }).slice(0, 700));
    assert('T6_engine_unchanged_without_pbr_declaration', plainReport.display?.engine === 'CYCLES'
      && plainReport.display?.declaredMaterial === false,
      JSON.stringify(plainReport.display ?? {}).slice(0, 200) + '（对照场景只声明环境光，declaredMaterial 必须为 false）');

    const plainPng = plainReport.renders?.front;
    const texturedPng = texturedReport.renders?.front;
    let pixel = null;
    if (plainPng && texturedPng && fs.existsSync(plainPng) && fs.existsSync(texturedPng)) {
      const before = lib.pngPixelStats(fs.readFileSync(plainPng));
      const after = lib.pngPixelStats(fs.readFileSync(texturedPng));
      pixel = { before, after };
      assert('T7_texture_changes_imaging_monotonically', after.r - before.r > 20 && before.b - after.b > 20,
        JSON.stringify({ before, after }).slice(0, 300));
    } else {
      assert('T7_texture_changes_imaging_monotonically', false,
        `render_png_missing plain=${plainPng || '—'} textured=${texturedPng || '—'}`);
    }

    // —— T8：sha 篡改不静默放行，同场景其余基本体照常构建 ——
    const tampered = await rest('POST', '/model3d/scene/export', {
      projectId,
      scene: sceneOf([
        box('panel', [0, 0, 0], { ...FLAT_BLUE, baseColorTexture: { path: 'model3d/textures/panel.png', sourceSha256: sha(Buffer.from('not-the-file')) } }),
        box('keepme', [200, 0, 0], FLAT_BLUE),
      ], 'P2-03 tampered'),
      scenePath: 'model3d/p203-tampered.scene3d.json',
      formats: ['glb'],
    });
    const tamperedReport = tampered.data?.report || {};
    assert('T8_tampered_sha_fails_loudly_not_silently', tamperedReport.ok === false
      && (tamperedReport.unsupported || []).some((row) => String(row.error || '').includes('texture_source_hash_mismatch'))
      && (tamperedReport.mesh?.volumesMm3 || {}).keepme !== undefined,
      JSON.stringify({ ok: tamperedReport.ok, unsupported: tamperedReport.unsupported, volumes: Object.keys(tamperedReport.mesh?.volumesMm3 || {}) }).slice(0, 320));

    const glb = (textured.data?.outputs || []).find((item) => String(item.path).toLowerCase().endsWith('.glb'));
    assert('T9_export_artifact_intact', Boolean(glb) && glb.bytes > 500 && /^[a-f0-9]{64}$/i.test(String(glb.sha256 || '')),
      JSON.stringify(glb ?? {}).slice(0, 200));

    // —— UI 腿：预览消费工作区贴图；取不到时按节点显式失败，不静默留白 ——
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
      var b = Array.prototype.slice.call(document.querySelectorAll('button'));
      for (var i = 0; i < b.length; i += 1) {
        var t = (b[i].textContent || '').trim();
        if (t === '开始使用' || t === '知道了' || t === '3D 模型') b[i].click();
      }
      return 'ok';
    })()`).catch(() => null);
    await poll(async () => (await evalJs(client, `!!document.querySelector('[data-testid="model3d-surface"]')`).catch(() => false)) === true
      ? true : null, { timeoutMs: 30_000, label: 'model3d_surface' });

    const readPanel = () => evalJs(client, `(function(){
      var p = document.querySelector('[data-testid="model3d-surface"]');
      return p ? (p.textContent || '').replace(/\\s+/g, '') : '';
    })()`);
    const goodSceneFile = path.join(os.tmpdir(), `block322-p203-texture-${Date.now()}.scene3d.json`);
    fs.writeFileSync(goodSceneFile, JSON.stringify(sceneOf([
      box('panel', [0, 0, 0], { ...FLAT_BLUE, metallic: 0.6, emissive: '#061018', baseColorTexture: textureSpec }),
      box('keepme', [200, 0, 0], FLAT_BLUE),
    ], 'P2-03 preview')), 'utf8');
    tempFiles.push(goodSceneFile);
    await setFileOnInput(client, '[data-testid="model3d-file-input"]', goodSceneFile);
    const goodPanel = await poll(async () => {
      const text = String(await readPanel().catch(() => ''));
      return text.includes('声明基础色贴图') && /渲染对象(\d+)/.test(text) && Number(/渲染对象(\d+)/.exec(text)[1]) >= 2 ? text : null;
    }, { timeoutMs: 45_000, intervalMs: 500, label: 'texture_notice_and_objects' });
    assert('U1_preview_loads_workspace_texture', goodPanel.includes('声明基础色贴图')
      && goodPanel.includes('model3d/textures/panel.png') && !goodPanel.includes('texture_reference_load_failed')
      && Number(/渲染对象(\d+)/.exec(goodPanel)[1]) >= 2, goodPanel.slice(0, 420));

    const goneSceneFile = path.join(os.tmpdir(), `block322-p203-gone-${Date.now()}.scene3d.json`);
    fs.writeFileSync(goneSceneFile, JSON.stringify(sceneOf([
      box('panel', [0, 0, 0], { ...FLAT_BLUE, baseColorTexture: { path: 'model3d/textures/deleted.png', sourceSha256: sha(RED_PNG) } }),
      box('keepme', [200, 0, 0], FLAT_BLUE),
    ], 'P2-03 preview missing')), 'utf8');
    tempFiles.push(goneSceneFile);
    await setFileOnInput(client, '[data-testid="model3d-file-input"]', goneSceneFile);
    const gonePanel = await poll(async () => {
      const text = String(await readPanel().catch(() => ''));
      return text.includes('texture_reference_load_failed') ? text : null;
    }, { timeoutMs: 45_000, intervalMs: 500, label: 'texture_failure_visible' });
    assert('U2_missing_texture_reported_per_node', gonePanel.includes('texture_reference_load_failed:panel')
      && gonePanel.includes('model3d/textures/deleted.png'), gonePanel.slice(0, 420));
    assert('U3_other_primitives_still_render', Number(/渲染对象(\d+)/.exec(gonePanel)?.[1] || 0) >= 1,
      JSON.stringify({ objects: Number(/渲染对象(\d+)/.exec(gonePanel)?.[1] || 0) }).slice(0, 160));

    detail.pixel = pixel;
    detail.materialsEcho = texturedReport.materials;
    detail.tampered = tamperedReport.unsupported;
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'block322-p2-03-material-detail.json'), `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      platform: `${process.platform}-${process.arch}`,
      capability: capability.data,
      expectation: '纯红贴图应让 front.png 的 R 均值上升、B 均值下降（同一环境光、同一引擎、同一采样数）',
      display: { plain: plainReport.display, textured: texturedReport.display },
      materials: texturedReport.materials,
      pixelStats: pixel,
      tamperedUnsupported: tamperedReport.unsupported,
      outputs: { textured: textured.data?.outputs || [] },
    }, null, 2)}\n`, 'utf8');
    return true;
  } finally {
    try { client?.socket?.close(); } catch { /* already closed */ }
    for (const file of tempFiles) { try { fs.rmSync(file, { force: true }); } catch { /* best effort */ } }
    if (textureOnDisk) { try { fs.rmSync(textureOnDisk, { force: true }); } catch { /* best effort */ } }
    if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null);
  }
}

module.exports = {
  id: 'block322-p2-03-material-live',
  description: 'BLOCK-322 P2-03：贴图预检/逐字节复验 + 声明 PBR 材质切 Cycles + 像素单调对照 + 篡改显式失败 + 预览按节点如实报错',
  evidenceDir: EVIDENCE_DIR,
  run,
};
