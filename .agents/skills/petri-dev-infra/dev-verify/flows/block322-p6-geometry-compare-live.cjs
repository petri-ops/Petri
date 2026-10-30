#!/usr/bin/env node
'use strict';
/** BLOCK-322 P6-03 实机：SceneSpec 对比面板 → 几何差异（真实 Blender 双报告）。 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const APP = 'http://localhost:3000';
const API = process.env.BLOCK322_API || 'http://127.0.0.1:3011';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-322-p6');
const WORKSPACE = path.join(EVIDENCE_DIR, 'ui-workspace');
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function evalJs(client, expr, timeoutMs = 20_000) {
  let timer = null;
  try { return await Promise.race([lib.evalJs(client, expr), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('cdp_eval_timeout')), timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}
async function poll(fn, { timeoutMs, intervalMs = 500, label }) {
  const end = Date.now() + timeoutMs; let last = null;
  while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(intervalMs); }
  throw new Error(`poll_timeout: ${label} :: ${JSON.stringify(last).slice(0, 200)}`);
}
async function rest(method, endpoint, body) {
  const r = await fetch(`${API}/api${endpoint}`, { method, headers: { Authorization: 'Bearer desktop-local', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15_000) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function run({ assert }) {
  let projectId = null; let client = null;
  try {
    fs.rmSync(WORKSPACE, { recursive: true, force: true });
    const project = await rest('POST', '/data/projects', { name: `B322-P6-${Date.now()}`, workspacePath: WORKSPACE });
    projectId = project.data?.project?.id || null;
    assert('G0_project_created', project.status === 200 && Boolean(projectId), JSON.stringify(project.data).slice(0, 180));
    client = await lib.connectTestTarget({ timeoutMs: 60_000 });
    await evalJs(client, `(function(){ localStorage.setItem('petri.workSurfaceTabs.v1.'+${JSON.stringify(projectId)}, JSON.stringify({version:1,tabs:[{id:'model3d',surfaceId:'model3d'}],activeId:'model3d'})); location.href=${JSON.stringify(APP + '/project/')}+${JSON.stringify(projectId)}; return 'go'; })()`);
    await poll(async () => (await evalJs(client, 'location.pathname').catch(() => '')) === `/project/${projectId}` ? true : null, { timeoutMs: 30_000, label: 'route' });
    await poll(async () => (await evalJs(client, `!!document.querySelector('textarea.sc-input')`).catch(() => false)) === true ? true : null, { timeoutMs: 40_000, label: 'workspace' }).catch(() => null);
    await evalJs(client, `(function(){
      if (!document.querySelector('[data-testid="model3d-surface"]')) { var e=document.querySelector('[aria-label="展开右侧栏"]'); if(e)e.click(); }
      var bs=Array.prototype.slice.call(document.querySelectorAll('button'));
      for(var i=0;i<bs.length;i++) if((bs[i].textContent||'').trim()==='3D 模型'){bs[i].click();return 'opened';}
      return 'missing';
    })()`).catch(() => null);
    await poll(async () => (await evalJs(client, `!!document.querySelector('[data-testid="model3d-surface"]')`).catch(() => false)) === true ? true : null, { timeoutMs: 20_000, label: 'surface' });
    await evalJs(client, `(function(){var p=document.querySelector('[data-testid="model3d-surface"]');var bs=Array.prototype.slice.call(p.querySelectorAll('button'));for(var i=0;i<bs.length;i++)if((bs[i].textContent||'').trim()==='加载示例'){bs[i].click();return 'ok';}return 'missing';})()`);
    const compareScene = { version: 'scene3d/v1', units: 'mm', coordinateSystem: 'z-up-right-handed', parameters: { width: 150, height: 40, depth: 80, wall: 2 }, nodes: [
      { id: 'enclosure', type: 'box', transform: { position: [0, 0, 0], rotation: [0, 0, 0] }, dimensions: { width: 'width', height: 'height', depth: 'depth' }, material: { color: '#4c78a8', roughness: 0.65 } },
      { id: 'port', type: 'cylinder', transform: { position: [75, 0, 0], rotation: [0, 90, 0] }, dimensions: { radius: 6, height: 8 }, material: { color: '#d29b42', roughness: 0.5 } },
    ], constraints: [], metadata: { title: 'compare' } };
    await evalJs(client, `(function(){
      var p=document.querySelector('[data-testid="model3d-surface"]');var input=p.querySelector('input[accept=".json,.scene3d.json"]');if(!input)return 'missing';
      var dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(compareScene))}],'compare.scene3d.json',{type:'application/json'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return 'injected';
    })()`);
    await poll(async () => (await evalJs(client, `!!document.querySelector('[data-testid="model3d-compare-panel"]')`).catch(() => false)) === true ? true : null, { timeoutMs: 10_000, label: 'compare_panel' });
    const clicked = await evalJs(client, `(function(){var p=document.querySelector('[data-testid="model3d-compare-panel"]');var bs=Array.prototype.slice.call(p.querySelectorAll('button'));for(var i=0;i<bs.length;i++)if((bs[i].textContent||'').trim()==='几何差异'){bs[i].click();return 'clicked';}return 'missing';})()`);
    assert('G1_geometry_clicked', clicked === 'clicked', String(clicked));
    const text = await poll(async () => {
      const t = await evalJs(client, `(function(){var n=document.querySelector('[data-testid="model3d-geometry-diff"]');return n?n.textContent:'';})()`).catch(() => '');
      return t.includes('Δ 30') && t.includes('体积') ? t : null;
    }, { timeoutMs: 120_000, intervalMs: 1000, label: 'geometry_diff' });
    assert('G2_geometry_diff', Boolean(text), String(text).slice(0, 600));
    assert('G3_bounds_delta_30', String(text).includes('Δ 30'), String(text).slice(0, 600));
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'geometry-ui.json'), JSON.stringify({ text }, null, 2));
    return true;
  } finally { try { client?.socket?.close(); } catch {} if (projectId) await rest('DELETE', `/data/projects/${encodeURIComponent(projectId)}`).catch(() => null); }
}
module.exports = { id: 'block322-p6-geometry-compare-live', description: 'BLOCK-322 P6-03 对比面板几何差值实机', evidenceDir: EVIDENCE_DIR, run };
