#!/usr/bin/env node
'use strict';

/**
 * BLOCK-52 P3 实机 CDP 断言驱动 — 微调闭环（旗舰时刻）：
 *   ResultView 引用真实 volcano-plot 结果图（带 artifact 血统）
 *   → 一句话自然语言微调 → agent 经 result_studio_context 绑定
 *   → result_edit_plan_in_context / result_changeset_create_in_context
 *   → 新 Revision 出图。
 *
 * 证据（断言 JSON + 截图）落 acceptance/block-52/。
 * 前置：
 *   dev Electron 已以 --remote-debugging-port=9222 启动；
 *   scripts/block52-p3-setup.cjs 已产出 volcano-plot Job（环境变量或默认 id）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');

const DEBUG_PORT = process.env.PETRI_DEBUG_PORT || '9222';
const PROJECT_ID = process.env.BIOF52_P3_PROJECT || 'p_mtlmxzv8_bbmw';
const TOOL_JOB_ID = process.env.BIOF52_P3_JOB || 'tj_mtlmxzyv_xbj9';
const ARTIFACT_NAME = 'volcano.png';
const DB_PATH = process.env.BIOF52_P3_DB
  || path.join(__dirname, '..', '.petri-dev-user-data', 'data', 'petri.db');
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-52');
const REVISION_WAIT_MS = 6 * 60 * 1000;
const REVISION_POLL_MS = 5000;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    require('http').get(url, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function evalJS(client, expr) {
  const r = await client.send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error(`evaluate_failed: ${r.exceptionDetails.text} ${r.exceptionDetails.exception?.description || ''}`.slice(0, 500));
  }
  return r.result.value;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function screenshot(client, file) {
  const r = await client.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
}

function sqliteRows(sql) {
  const out = execFileSync('sqlite3', [DB_PATH, '-json', sql], { encoding: 'utf8' });
  return out.trim() ? JSON.parse(out) : [];
}

function revisionsForProject() {
  return sqliteRows(
    `SELECT revision_id, revision_ordinal, tool_job_id, artifact_id, artifact_family_id, is_current
     FROM artifact_revisions WHERE project_id='${PROJECT_ID}' ORDER BY revision_ordinal`,
  );
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const targets = await fetchJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const page = targets.find((t) => t.type === 'page' && /localhost:3000/.test(t.url || ''));
  if (!page) throw new Error('petri_page_not_found');
  const client = await new CdpClient(page.webSocketDebuggerUrl).connect();

  const results = {
    startedAt: new Date().toISOString(),
    page: page.url,
    projectId: PROJECT_ID,
    toolJobId: TOOL_JOB_ID,
    assertions: [],
  };
  const assert = (name, pass, detail) => {
    results.assertions.push({ name, pass: !!pass, detail: String(detail || '').slice(0, 400) });
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  // 0. 记录基线 revision 状态（应尚无任何正式 Revision）
  const beforeRevisions = revisionsForProject();
  results.beforeRevisions = beforeRevisions;

  // 1. 导航到 P3 项目（corpus 项目，workspace 为空目录 + 已完成 volcano-plot Job）
  await evalJS(client, `(location.href = '/project/${PROJECT_ID}?mode=chat', true)`);
  await delay(2500);

  // 2. 通过 projectOpenResult 事件打开 volcano-plot 结果（ResultView + interaction 物化基线）
  await evalJS(client, `(window.dispatchEvent(new CustomEvent('petri:project-open-result', {
    detail: { toolJobId: '${TOOL_JOB_ID}', projectId: '${PROJECT_ID}' }
  })), true)`);
  await delay(1500);

  // 3. 等待 ResultView 图片预览出现（interaction 路由物化基线 Revision）
  let previewReady = null;
  for (let i = 0; i < 30; i += 1) {
    previewReady = await evalJS(client, `(() => {
      const btn = [...document.querySelectorAll('button')].find(el => el.textContent.includes('引用到对话'));
      const img = document.querySelector('.resultPreviewImageCanvas img, [class*="resultPreviewImage"] img');
      return { hasQuoteBtn: !!btn, hasImage: !!img };
    })()`);
    if (previewReady && previewReady.hasQuoteBtn && previewReady.hasImage) break;
    await delay(2000);
  }
  assert('ResultView 打开 volcano.png 图片预览（含引用按钮）',
    !!(previewReady && previewReady.hasQuoteBtn && previewReady.hasImage),
    JSON.stringify(previewReady));
  await screenshot(client, path.join(EVIDENCE_DIR, 'p3-01-result-opened.png'));

  // 4. 基线 Revision（ordinal 1）已由 interaction 物化
  let afterOpen = [];
  for (let i = 0; i < 30; i += 1) {
    afterOpen = revisionsForProject();
    if (afterOpen.length >= 1) break;
    await delay(2000);
  }
  const baseline = afterOpen.find((r) => r.revision_ordinal === 1);
  assert('interaction 物化基线 Revision（ordinal=1，is_current）',
    !!baseline && baseline.tool_job_id === TOOL_JOB_ID,
    JSON.stringify(afterOpen));

  // 5. 点击「引用到对话」→ composer 出现带血统的结果图引用卡
  const quoteBtn = await evalJS(client, `(() => {
    const b = [...document.querySelectorAll('button')].find(el => el.textContent.includes('引用到对话'));
    if (!b) return null;
    b.click();
    return true;
  })()`);
  assert('ResultView 出现「引用到对话」按钮并可点击', quoteBtn === true, quoteBtn);
  await delay(800);

  const card = await evalJS(client, `(() => {
    const card = document.querySelector('.sc-image-ref');
    if (!card) return null;
    return {
      name: card.querySelector('.sc-image-ref-name')?.textContent,
      source: card.querySelector('.sc-image-ref-source')?.textContent,
      hasThumb: !!card.querySelector('.sc-image-ref-thumb'),
    };
  })()`);
  assert('composer 出现 Result Studio 结果图引用卡（缩略图+血统来源行）',
    !!card && card.hasThumb && card.name === ARTIFACT_NAME && /Result Studio/.test(card.source || ''),
    JSON.stringify(card));
  await screenshot(client, path.join(EVIDENCE_DIR, 'p3-02-quoted.png'));

  // 6. 一句话自然语言微调 + Enter 发送
  const typed = await evalJS(client, `(async () => {
    const ta = document.querySelector('.sc-input');
    if (!ta) return { ok: false, reason: 'no_textarea' };
    ta.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, '请参考引用的这张火山图结果，把点的大小调大一些（point_size 调到 3.2），基因标签文字也放大一点（label_size 调到 4.5），其他都保持不变。完成后告诉我新的版本号。');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    return { ok: true };
  })()`);
  assert('composer 输入微调语句并发送', typed && typed.ok, JSON.stringify(typed));
  await delay(2500);
  await screenshot(client, path.join(EVIDENCE_DIR, 'p3-03-sent.png'));

  // 7. 轮询等待新 Revision（ordinal ≥ 2 的候选即算；基线 cohort 本身就有
  // 多个 ordinal=1 行，不能用行数判断）。adopt 与否不影响闭环断言。
  const deadline = Date.now() + REVISION_WAIT_MS;
  let revisions = afterOpen;
  let candidate = null;
  while (Date.now() < deadline) {
    await delay(REVISION_POLL_MS);
    revisions = revisionsForProject();
    candidate = revisions.find((r) => r.revision_ordinal >= 2) || null;
    if (candidate) break;
    const uiText = await evalJS(client, `document.body.innerText.slice(-600)`).catch(() => '');
    if (/需要你确认|待确认|approval/i.test(uiText || '')) {
      console.log('NOTICE: UI 出现待确认提示，继续等待用户侧批准不适用于自动化边界');
    }
  }
  const candidateFinal = candidate;
  results.afterRevisions = revisions;
  assert('agent 微调闭环产出新 Revision（ordinal≥2）', !!candidateFinal, JSON.stringify(revisions));

  // 8. 新 Revision 归属同一 artifact family 且来自新的 tool job（真实重跑）
  if (candidateFinal && baseline) {
    assert('新 Revision 与基线同 artifact family（重跑链路）',
      candidateFinal.artifact_family_id === baseline.artifact_family_id,
      `${candidateFinal.artifact_family_id} vs ${baseline.artifact_family_id}`);
    assert('新 Revision 来自新 tool job（真实改参重跑）',
      candidateFinal.tool_job_id !== baseline.tool_job_id,
      `${candidateFinal.tool_job_id} vs ${baseline.tool_job_id}`);
    const rerunParams = sqliteRows(
      `SELECT params_json FROM tool_jobs WHERE id='${candidateFinal.tool_job_id}'`,
    );
    let pointSize = null;
    try { pointSize = JSON.parse(rerunParams[0].params_json).point_size; } catch { /* ignore */ }
    assert('重跑 Job 参数含 point_size=3.2（自然语言→参数 Patch）',
      Number(pointSize) === 3.2,
      JSON.stringify(rerunParams).slice(0, 300));
  }

  await delay(2000);
  await screenshot(client, path.join(EVIDENCE_DIR, 'p3-04-new-revision.png'));

  results.finishedAt = new Date().toISOString();
  results.pass = results.assertions.every((a) => a.pass);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p3-live-assertions.json'), JSON.stringify(results, null, 2));
  console.log(results.pass ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(results.pass ? 0 : 1);
}

main().catch((e) => { console.error('driver_error:', e.message); process.exit(2); });
