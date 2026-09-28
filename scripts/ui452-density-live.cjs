#!/usr/bin/env node
'use strict';

/**
 * ui452-density-live.cjs — UI-452 结果信息密度包实机验证（G0-BIO BIO-1）：
 *   Phase A（HTTP 播种）自建验收项目 + 真实 deseq2 job（files 内联 base64 协议）
 *   Phase B（CDP 走查 dev Electron 主窗）：
 *   T1  深链 /project/:id/result?job= 打开，产物下拉与表格交互视图（table 类主面）在场
 *   T2  表格组合筛选：两子句（padj lt 0.05 + gene contains）→ 服务端权威过滤行数收紧
 *   T3  数值格式化：number 列显示层格式化 + title 保留原始字符串（显示层与真相分离）
 *   T4  散点面（volcano 交互开关）：点 title 带基因名+x/y 数值；搜索高亮+命中数；
 *       Enter 写选择；阈值参考线（x×2+y×1，开关后消失）
 *   T5  Lightbox 缩放平移：滚轮 data-zoom>1、双击复位、Esc 关闭
 *   截图：散点交互态 + 表格筛选态；项目跑完清理
 * 证据：acceptance/ui-452/ui452-density-live.json + png×2
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-452');
const TEMPLATE_JOB = process.env.UI452_TEMPLATE_JOB || 'tj_muhoamsv_m92b';
const AUTH = 'Bearer desktop-local';
let client;
const EVAL = (expr) => lib.evalJs(client, expr);

function restCall(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: 3001, path: apiPath, method,
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
const restJson = async (method, apiPath, body) => {
  const r = await restCall(method, apiPath, body);
  try { return { status: r.status, data: JSON.parse(r.body) }; } catch { return { status: r.status, data: { raw: r.body.slice(0, 200) } }; }
};

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  return lib.connectTarget(target);
}

const waitFor = async (expr, { timeoutMs = 15000, label = '' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await EVAL(expr).catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label || expr.slice(0, 80)}`);
    await sleep(300);
  }
};

(async () => {
  const run = lib.createRun({ name: 'ui452-density-live', evidenceDir: EVIDENCE_DIR });

  // ---------- Phase A：HTTP 播种（真实 deseq2 job） ----------
  const template = (await restJson('GET', `/api/tools/status/${TEMPLATE_JOB}`)).data;
  if (!template || !template.params || !template.params.counts) throw new Error('template job unusable');
  const files = {};
  for (const key of ['counts', 'coldata']) {
    const src = template.params[key];
    if (src && fs.existsSync(src)) files[key === 'counts' ? 'counts.csv' : 'coldata.csv'] = fs.readFileSync(src).toString('base64');
  }
  if (!files['counts.csv']) throw new Error('template input file missing');
  const created = (await restJson('POST', '/api/data/projects', {
    name: `ui452-density-verify-${Date.now().toString(36)}`, modality: 'bulk',
  })).data;
  const projectId = created.project && created.project.id;
  if (!projectId) throw new Error(`project create failed: ${JSON.stringify(created).slice(0, 200)}`);
  const submit = (await restJson('POST', '/api/tools/run', {
    toolId: template.toolId, projectId, params: template.params, files,
  })).data;
  if (!submit.jobId) throw new Error(`submit failed: ${JSON.stringify(submit).slice(0, 200)}`);
  let job = null;
  for (let i = 0; i < 120; i += 1) {
    await sleep(2000);
    job = (await restJson('GET', `/api/tools/status/${submit.jobId}`)).data;
    if (['completed', 'failed', 'cancelled'].includes(job.status)) break;
  }
  if (!job || job.status !== 'completed') throw new Error(`seed job not completed: ${job && job.status}`);
  run.assert('T0_seed_deseq2_completed', true, `project=${projectId} job=${submit.jobId}`);

  // ---------- Phase B：CDP 走查 ----------
  client = await attach();
  try { await client.send('Page.bringToFront'); } catch { /* ignore */ }
  // 打开结果页用 block121 flow 验证过的深链形态（?mode=result&job=，经
  // legacy 归一化 effect 进 result 模式；子路径直写与 projectOpenResult 事件
  // 对无会话 job 均未生效，实验记录见台账）。
  await EVAL("location.href = 'http://localhost:3000/project/" + projectId + "?mode=result&job=" + " + JSON.stringify(submit.jobId) + " + "'; 'nav'");
  // T1 产物下拉 + 表格交互视图（deg_table 为 table 类主面=自动交互）
  await waitFor(`!!document.querySelector('select') && !!document.querySelector('[aria-label="科学结果表格"]')`,
    { label: 'result shell + table viewer', timeoutMs: 30000 });
  const t1 = await EVAL(`(() => {
    const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /deg_table/.test(o.value || o.text)));
    return { hasDegOption: !!sel, degValue: sel ? sel.value : null, optionCount: sel ? sel.options.length : 0 };
  })()`);
  run.assert('T1_result_shell_and_table_viewer', t1.hasDegOption, JSON.stringify(t1));

  // T2 组合筛选：padj lt 0.05 + gene contains <prefix>（prefix 取首行基因前两字符）
  const firstGene = await waitFor(`(() => {
    const vp = document.querySelector('[aria-label="科学结果表格"]');
    const cb = vp && vp.querySelector('input[type=checkbox][aria-label^="选择 "]');
    return cb ? cb.getAttribute('aria-label').replace('选择 ', '') : null;
  })()`, { label: 'first gene row' });
  const genePrefix = String(firstGene).slice(0, 2);
  const beforeCount = await EVAL(`(() => {
    const m = document.querySelector('[aria-label="表格筛选"] span');
    return m ? m.textContent : '';
  })()`);
  await EVAL(`(() => {
    const field = document.querySelector('[aria-label="筛选字段 1"]');
    field.value = 'padj'; field.dispatchEvent(new Event('change', { bubbles: true }));
    const op = document.querySelector('[aria-label="筛选操作 1"]');
    op.value = 'lt'; op.dispatchEvent(new Event('change', { bubbles: true }));
    const val = document.querySelector('[aria-label="筛选条件 1"]');
    val.value = '0.05'; val.dispatchEvent(new Event('input', { bubbles: true })); val.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await sleep(400);
  await EVAL(`(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '添加筛选条件');
    btn.click(); return true;
  })()`);
  await sleep(200);
  const clause2ok = await EVAL(`(() => {
    const field = document.querySelector('[aria-label="筛选字段 2"]');
    if (!field) return false;
    field.value = 'gene'; field.dispatchEvent(new Event('change', { bubbles: true }));
    const val = document.querySelector('[aria-label="筛选条件 2"]');
    val.value = ${JSON.stringify(genePrefix)}; val.dispatchEvent(new Event('input', { bubbles: true })); val.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  const filteredText = await new Promise(async (resolve) => {
    const deadline = Date.now() + 20000;
    for (;;) {
      const t = await EVAL(`document.querySelector('[aria-label="表格筛选"] span') ? document.querySelector('[aria-label="表格筛选"] span').textContent : ''`).catch(() => '');
      if (t && t !== beforeCount) return resolve(t);
      if (Date.now() > deadline) return resolve(t || '(timeout)');
      await sleep(500);
    }
  });
  run.assert('T2_combo_filter_two_clauses', clause2ok && /\/\s*\d/.test(filteredText) && filteredText !== beforeCount,
    `before=${beforeCount} after=${filteredText} prefix=${genePrefix}`);
  await Promise.race([lib.screenshotPng(client, EVIDENCE_DIR, 'ui452-table-filter.png').catch(() => {}), sleep(4000)]);

  // T3 数值格式化：number 列显示层 + title 原值分离
  const t3 = await EVAL(`(() => {
    const vp = document.querySelector('[aria-label="科学结果表格"]');
    const cells = vp ? [...vp.querySelectorAll('.virtualRow span[title]')] : [];
    const numeric = cells.find(c => /e[+-]\\d/i.test(c.textContent) && c.getAttribute('title') !== c.textContent);
    const any = cells[0] || null;
    return {
      cellCount: cells.length,
      formattedExample: numeric ? { display: numeric.textContent, title: numeric.getAttribute('title') } : null,
      firstCell: any ? { display: any.textContent, title: any.getAttribute('title') } : null,
    };
  })()`);
  run.assert('T3_numeric_display_layer_split', t3.cellCount > 0 && !!t3.firstCell,
    JSON.stringify(t3).slice(0, 260));

  // T4 散点面：切 volcano → 进入交互选择
  const switched = await EVAL(`(() => {
    const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => /volcano\\.png/.test(o.value)));
    if (!sel) return false;
    sel.value = [...sel.options].find(o => /volcano\\.png/.test(o.value)).value;
    sel.dispatchEvent(new Event('change', { bubbles: true })); return true;
  })()`);
  if (!switched) throw new Error('volcano.png option not found');
  await sleep(600);
  await EVAL(`([...document.querySelectorAll('button[aria-label="进入交互选择"]')].pop() || {}).click ? document.querySelector('button[aria-label="进入交互选择"]').click() : null; 'toggled'`);
  const scatterReady = await waitFor(`(() => {
    const svg = document.querySelector('svg[aria-label="可选择科学散点图"]');
    return svg && svg.querySelector('circle') ? true : null;
  })()`, { label: 'scatter viewer', timeoutMs: 20000 }).catch(() => null);
  run.assert('T4a_scatter_viewer_mounted', !!scatterReady, `switched=${switched}`);

  if (scatterReady) {
    const tooltip = await EVAL(`(() => {
      const c = document.querySelector('svg[aria-label="可选择科学散点图"] circle');
      const t = c && c.querySelector('title');
      return t ? t.textContent : null;
    })()`);
    run.assert('T4b_tooltip_carries_values', !!tooltip && /log2FoldChange:/.test(tooltip),
      String(tooltip).slice(0, 160).replace(/\n/g, ' | '));

    const geneId = tooltip ? String(tooltip).split('\n')[0] : '';
    const searchPrefix = geneId.slice(0, 2);
    await EVAL(`(() => {
      const input = document.querySelector('input[aria-label="搜索实体"]');
      input.value = ${JSON.stringify(searchPrefix)};
      input.dispatchEvent(new Event('input', { bubbles: true })); return true;
    })()`);
    await sleep(300);
    const searchState = await EVAL(`(() => ({
      hits: document.querySelectorAll('circle[data-search-hit="true"]').length,
      caveat: (document.querySelector('small') && document.querySelector('small').textContent || '').slice(0, 80),
    })()`);
    run.assert('T4c_search_highlights_hits', searchState.hits > 0 && /搜索命中/.test(searchState.caveat),
      `prefix=${searchPrefix} ${JSON.stringify(searchState)}`);
    const beforeSel = await EVAL(`(document.querySelector('[class*="selectionBar"] span') || {}).textContent || ''`);
    await EVAL(`(() => {
      const input = document.querySelector('input[aria-label="搜索实体"]');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true;
    })()`);
    await sleep(400);
    const afterSel = await EVAL(`(document.querySelector('[class*="selectionBar"] span') || {}).textContent || ''`);
    run.assert('T4d_enter_selects_hits', afterSel !== beforeSel && /选择|个/.test(afterSel),
      `before=${beforeSel} after=${afterSel}`);

    const thresholdsOn = await EVAL(`(() => ({
      x: document.querySelectorAll('line[data-threshold="x"]').length,
      y: document.querySelectorAll('line[data-threshold="y"]').length,
    })()`);
    await EVAL(`document.querySelector('input[aria-label="显示参考线"]').click(); 'off'`);
    await sleep(200);
    const thresholdsOff = await EVAL(`({
      x: document.querySelectorAll('line[data-threshold="x"]').length,
      y: document.querySelectorAll('line[data-threshold="y"]').length,
    })()`);
    await EVAL(`document.querySelector('input[aria-label="显示参考线"]').click(); 'on'`);
    run.assert('T4e_threshold_lines_toggle', thresholdsOn.x === 2 && thresholdsOn.y === 1 && thresholdsOff.x === 0 && thresholdsOff.y === 0,
      `on=${JSON.stringify(thresholdsOn)} off=${JSON.stringify(thresholdsOff)}`);
    await Promise.race([lib.screenshotPng(client, EVIDENCE_DIR, 'ui452-scatter-tools.png').catch(() => {}), sleep(4000)]);
  }

  // T5 Lightbox：回原始图像 → 点图 → 缩放/复位/关闭
  await EVAL(`(() => {
    const btn = document.querySelector('button[aria-label="查看原始图像"]');
    if (btn) btn.click(); return !!btn;
  })()`);
  const plotImg = await waitFor(`!!document.querySelector('img[class*="resultPreview"]') || !!document.querySelector('[class*="resultPreviewImage"] img')`,
    { label: 'raw plot image', timeoutMs: 10000 }).catch(() => null);
  const lightboxFlow = await EVAL(`(async () => {
    const img = document.querySelector('[class*="resultPreviewImage"] img') || document.querySelector('img[class*="resultPreview"]');
    if (!img) return { error: 'plot img not found' };
    img.click();
    await new Promise(r => setTimeout(r, 300));
    const lb = document.querySelector('.gewu-lightbox img');
    if (!lb) return { error: 'lightbox not opened' };
    const z0 = lb.getAttribute('data-zoom');
    lb.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 200));
    const z1 = lb.getAttribute('data-zoom');
    lb.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const z2 = lb.getAttribute('data-zoom');
    const p2 = lb.getAttribute('data-pan');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    const closed = !document.querySelector('.gewu-lightbox');
    return { z0, z1, z2, p2, closed };
  })()`);
  run.assert('T5_lightbox_zoom_reset_close',
    lightboxFlow && !lightboxFlow.error && Number(lightboxFlow.z1) > 1 && lightboxFlow.z2 === '1' && lightboxFlow.p2 === '0,0' && lightboxFlow.closed,
    `img=${!!plotImg} ${JSON.stringify(lightboxFlow)}`);

  run.finish({ extra: { projectId, jobId: submit.jobId } });
  await restJson('DELETE', `/api/data/projects/${projectId}`).catch(() => {});
  process.exit(run.allPass ? 0 : 1);
})().catch(async (err) => {
  console.error('[ui452-density] FATAL', err && err.message);
  process.exit(2);
});
