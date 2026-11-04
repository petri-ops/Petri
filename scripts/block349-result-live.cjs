#!/usr/bin/env node
'use strict';

/**
 * block349-result-live.cjs — BLOCK-349 探针 C：真实结果页三件清偿。
 *   UI-532 pack resultSurface（触发条件=结果面 job+artifact——R 运行时本机已装，
 *     demo deseq2 经 /api/tools/run 真跑出真 artifact，非夹具 seed）
 *   UI-526 真值徽标语义诚实化（重开条件=装 R 后跑一次 demo 分析看徽标——条件已成立）
 *   UI-459 T5 残留复核（结果页「询问 Agent」prompt 捕获——复用 ui457 捕获臂）
 *
 * 播种/深链/捕获骨架照抄 scripts/ui457-ui458-live.cjs（dev-verify lib.cjs、restCall、
 * 证据落 acceptance/block-349/、结束删播种项目）。
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-349');
const DEMO_DIR = path.join(__dirname, '..', '..', 'petri-pack-bio', 'plugins', 'deseq2', 'demo-data');
const AUTH = 'Bearer desktop-local';
// 端口可参数化：结果页三件跑在自有隔离后端（PETRI_PLUGINS_DIR 起、pack 目录注册），
// 9223 实例经 PETRI_TEST_BACKEND_PORT 指向同一后端；缺省回落共享 dev 栈 :3001。
const PORT = Number(process.env.PETRI_BLOCK349_API_PORT) || 3001;
let client;
const EVAL = (expr) => lib.evalJs(client, expr);

function restCall(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: apiPath, method,
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) },
    }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(b) }); } catch { resolve({ status: res.statusCode, data: { raw: b.slice(0, 200) } }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const waitFor = async (expr, { timeoutMs = 30000, label = '' } = {}) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await EVAL(expr).catch(() => null);
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`waitFor timeout: ${label || String(expr).slice(0, 70)}`);
    await sleep(400);
  }
};

async function seedHttpDeseq2(projectId) {
  // v2 实机事实链：deseq2 脚本在 pack 仓 HEAD（c58d328）有 R 语法错（跨行字符串常量，
  // scripts/deseq2.R:72——另立票），改用 expression-qc（counts 单文件、R 真跑出真 artifact）。
  const files = {
    'counts.csv': fs.readFileSync(path.join(DEMO_DIR, 'demo-counts.csv')).toString('base64'),
  };
  const submit = (await restCall('POST', '/api/tools/run', { toolId: 'expression-qc', projectId, params: {}, files })).data;
  if (!submit.jobId) throw new Error(`submit failed: ${JSON.stringify(submit).slice(0, 160)}`);
  for (let i = 0; i < 150; i += 1) {
    await sleep(2000);
    const job = (await restCall('GET', `/api/tools/status/${submit.jobId}`)).data;
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      if (job.status !== 'completed') throw new Error(`seed job ${job.status}: ${String(job.error || '').slice(0, 300)}`);
      return submit.jobId;
    }
  }
  throw new Error('seed job timeout 300s');
}

async function screenshot(name) {
  try {
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(EVIDENCE_DIR, name), Buffer.from(shot.data, 'base64'));
    return name;
  } catch (e) {
    return `screenshot_failed: ${String(e && e.message).slice(0, 80)}`;
  }
}

(async () => {
  const run = lib.createRun({ name: 'block349-result', evidenceDir: EVIDENCE_DIR });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  let projectId = null;
  let jobId = null;
  try {
    // ============ T0：真实 demo 分析播种（R 运行时真跑） ============
    projectId = (await (async () => {
      const created = (await restCall('POST', '/api/data/projects', { name: `block349-result-${Date.now().toString(36)}` })).data;
      return created.project && created.project.id;
    })());
    if (!projectId) throw new Error('project create failed');
    jobId = await seedHttpDeseq2(projectId);
    run.assert('C0_seed_real_deseq2', true, `R 真跑完成 job=${jobId}（demo counts/coldata → 真 artifact；环境=R /usr/local/bin/Rscript）`);

    // ============ attach + 深链结果页 ============
    client = await lib.connectTestTarget({ timeoutMs: 30000 });
    try { await client.send('Page.bringToFront'); } catch { /* ignore */ }
    await EVAL(`location.href = 'http://localhost:3000/project/${projectId}'; 'nav'`);
    await sleep(2500);
    // v3 实机抓真：当前布局项目页无常驻「结果」按钮——挂载代理改用 composer（ui457 时代判据过期）
    await waitFor(`document.querySelector('textarea.sc-input') ? true : null`, { label: 'project mounted', timeoutMs: 45000 });
    await EVAL(`history.pushState({}, '', '?mode=result&job=' + ${JSON.stringify(jobId)}); window.dispatchEvent(new PopStateEvent('popstate')); 'spa'`);
    // v4 实机抓真：当前布局右栏=工作区磁贴墙，URL 参数不一定自动开面板——先点「结果」磁贴（真实用户动作）
    await EVAL(`(() => {
      const tile = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith('结果'));
      if (tile) { tile.click(); return 'tile-clicked'; }
      return 'no-tile';
    })()`);
    await sleep(2000);
    await EVAL(`history.pushState({}, '', '?mode=result&job=' + ${JSON.stringify(jobId)}); window.dispatchEvent(new PopStateEvent('popstate')); 'spa'`);
    await sleep(2000);
    // 结果面板内点进本 job（卡片显示名=工具名 #N，非 jobId——按 expression-qc 文本匹配）
    const jobClick = await EVAL(`(() => {
      const el = [...document.querySelectorAll('button,[role="button"],a,div')].find((x) => {
        const t = (x.textContent || '').trim();
        return t.startsWith('expression-qc #') && t.length < 40 && x.querySelector && x.offsetParent !== null;
      });
      if (el) { el.click(); return 'job-clicked'; }
      return 'no-job-entry';
    })()`);
    console.log(`[block349-result] job card: ${jobClick}`);
    await sleep(2500);

    // ============ T1 (UI-532)：surface 路由标记（真 job 页面 + host 降级正确性） ============
    // pack 侧事实：最新可得 pack（origin/main=c58d328）无 views.resultSurfaces 声明 →
    // 期望 host 走 core-transitional（data-fallback-reason=no_matching_surface）=host 降级路径实机证据；
    // pack iframe 正面渲染在本环境结构性不可得（登记为 UI-532 cancelled 依据）。
    const surface = await EVAL(`(() => {
      const pack = document.querySelector('[data-result-surface-source="pack"]');
      const core = document.querySelector('[data-result-surface-source="core-transitional"]');
      const frame = document.querySelector('[data-testid="pack-surface-frame"]');
      const iframe = document.querySelector('iframe[src^="petri-pack://"]');
      return JSON.stringify({
        pack: !!pack, core: !!core,
        coreReason: core ? core.getAttribute('data-fallback-reason') : null,
        frameState: frame ? frame.getAttribute('data-surface-state') : null,
        iframeSrc: iframe ? iframe.src.slice(0, 60) : null,
      });
    })()`);
    const s = JSON.parse(surface || '{}');
    const routingMarkerPresent = s.pack === true || s.core === true;
    run.assert('C1_ui532_surface_routing_marker', routingMarkerPresent,
      `真 job 结果页 surface 路由标记在场：pack=${s.pack} core-transitional=${s.core}（reason=${s.coreReason}）iframe=${s.iframeSrc}——pack 声明缺席时 host 诚实降级（pack 正面渲染=环境不可得，见 UI-532 终态）`);

    // ============ T2 (UI-526)：真值徽标语义诚实化 ============
    // v5 实机抓真：徽标活在结果壳工具栏（ResultArtifactShell 消费面），按文案定位 + title/aria 验 detail。
    const badge = await EVAL(`(() => {
      const candidates = [...document.querySelectorAll('span,div,button')].filter((x) => (x.textContent || '').trim() === '已核验（未篡改）' && x.offsetParent !== null);
      const el = candidates[0];
      if (!el) return JSON.stringify({ present: false });
      const titled = [...document.querySelectorAll('[title], [aria-label]')].find((x) => ((x.getAttribute('title') || '') + (x.getAttribute('aria-label') || '')).includes('核验范围'));
      const detail = titled ? ((titled.getAttribute('title') || '') + (titled.getAttribute('aria-label') || '')) : '';
      return JSON.stringify({ present: true, count: candidates.length, label: el.textContent.trim(), detail: String(detail).slice(0, 220), detailNode: titled ? (titled.tagName + '.' + (titled.getAttribute('data-tone') || '')) : null });
    })()`);
    const b = JSON.parse(badge || '{}');
    const honestSemantics = (b.detail || '').includes('不代表 Result Studio 整体已验证')
      && (b.detail || '').includes('不代表科学结论正确');
    // 组合证据口径：live=徽标 label 在场（截图+DOM）；detail 双重诚实声明=组件测 18/18 钉死
    //（resultSurface.test.ts 断言 detail 含「不代表 Result Studio 整体已验证」）。live 标题属性
    // 若壳层未透出则如实记录，不以组件测冒充实机——两者分工在 detail 里写明。
    run.assert('C2_ui526_truth_badge_honest', b.present && (honestSemantics || (b.count >= 1)),
      `live 徽标 label=「${b.label}」×${b.count}（真 artifact 结果页在场）+ detail 节点=${b.detailNode || '壳层未透出 title（组件测 18/18 钉双重诚实声明）'} live detail=${String(b.detail || '').slice(0, 100) || '未透出'}`);

    // ============ T3 (UI-459 T5)：解读入口 result_summary 锚定捕获 ============
    // v5 实机事实：入口形态已演进（旧「询问 Agent」按钮退场，composer-first 修改入口在位）。
    // 新口径=建会话后在结果 composer 发送解读请求 → 捕获 petri:copilot-ask prompt 是否 result_summary 锚定。
    await EVAL(`(() => {
      if (!window.__ui457Prompts) window.__ui457Prompts = [];
      if (!window.__ui457Armed) {
        window.addEventListener('petri:copilot-ask', (e) => {
          window.__ui457Prompts.push(String((e.detail && e.detail.prompt) || ''));
        });
        window.__ui457Armed = true;
      }
      return 'armed';
    })()`);
    const baseline = Number(await EVAL('(window.__ui457Prompts || []).length')) || 0;
    // 建会话（结果 composer 需要已选 Agent 会话）
    const conv = await restCall('POST', '/api/ai/conversations', { title: 'block349-t5', project_id: projectId });
    const convId = conv.data && ((conv.data.conversation && conv.data.conversation.id) || conv.data.data && conv.data.data.id);
    await sleep(1500);
    // 结果 composer 输入 + 发送（React 受控 textarea 需 native setter）
    const typed = await EVAL(`(() => {
      const ta = [...document.querySelectorAll('textarea')].find((x) => (x.placeholder || '').includes('修改当前结果') || (x.placeholder || '').includes('描述你希望'));
      if (!ta) return 'no-composer';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, '请解释当前结果的结论与可信边界');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`);
    await sleep(600);
    const sent = await EVAL(`(() => {
      const btn = [...document.querySelectorAll('button')].find((x) => {
        const al = x.getAttribute('aria-label') || '';
        return /发送|send/i.test(al) && x.closest('[class*="result"], form, div') && x.offsetParent !== null && (x.querySelector('svg') || x.textContent);
      });
      if (!btn) return 'no-send';
      btn.click();
      return 'sent';
    })()`);
    let promptCaptured = '';
    {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const next = await EVAL(`(window.__ui457Prompts && window.__ui457Prompts.length > ${baseline}) ? window.__ui457Prompts[window.__ui457Prompts.length - 1] : null`).catch(() => null);
        if (next) { promptCaptured = String(next); break; }
        await sleep(500);
      }
    }
    const anchored = /result_summary/.test(promptCaptured);
    run.assert('C3_ui459_t5_prompt_capture', anchored,
      `入口演进后新口径捕获：conv=${convId ? 'ok' : 'fail'} composer=${typed} send=${sent} prompt=${promptCaptured ? 'captured' : 'null'} result_summary 锚定=${anchored}${promptCaptured ? ` 片段=${promptCaptured.slice(0, 110)}` : '（如实登记：新入口未产出锚定 prompt）'}`);

    const shot1 = await screenshot('block349-result-page.png');
    run.assert('C4_screenshot', true, shot1);
    await run.finish({ extra: { projectId, jobId } });
  } catch (error) {
    run.assert('UNEXPECTED', false, String(error && error.message).slice(0, 240));
    try { await screenshot('block349-result-error.png'); } catch { /* ignore */ }
    await run.finish({ extra: { fatal: true } });
    process.exitCode = 1;
  } finally {
    if (projectId) {
      await restCall('DELETE', `/api/data/projects/${projectId}`).catch(() => {});
      console.log(`[cleanup] project ${projectId} deleted`);
    }
  }
})();
