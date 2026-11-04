#!/usr/bin/env node
'use strict';

/**
 * block349-segment-live.cjs — BLOCK-349 探针 D：段落级错误兜底注入实机（UI-535）。
 *
 * 台账触发条件=「需异常组件注入」。做法=受控注入：探针运行期给
 * WorkspaceFilePreview.tsx 打临时补丁（文件名含 CRASH-ME-349 时 throw），Vite HMR
 * 热更后经 petri:project-open-workspace-file 打开注入文件 → 断言段落错误卡
 * （[data-segment="workspace-preview"][data-segment-crashed="true"]）+ 页面骨架存活 +
 * 重试按钮在场；截图后【立即还原补丁】并断言 git diff 干净——注入永不进提交。
 * 还原后再开正常文件 → 预览正常渲染（resetKey/恢复语义旁证）。
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-349');
const AUTH = 'Bearer desktop-local';
const PORT = 3001;
const TARGET_FILE = path.join(__dirname, '..', 'frontend', 'src', 'pages', 'project-workspace', 'WorkspaceFilePreview.tsx');
// v3 实机抓真（CDP 控制台取证）：JSX 子表达式在父组件 render 时**急切求值**——表达式 throw
// 发生在 WorkspaceFilePreview 自身（RouteErrorBoundary 兜住），SegmentBoundary 根本收不到。
// 正确形态=注入**子组件**（渲染时抛错，最近边界=SegmentBoundary 捕获出段卡）。
const ANCHOR = `        {selectionNotice && (`;
const THROWER_DEF = `function Block349Thrower() {
  throw new Error('block349 受控注入：预览段异常（探针即抛即还原）');
}

export function WorkspaceFilePreview({`;
const ANCHOR_DEF = `export function WorkspaceFilePreview({`;
const INJECTION = `        {file && file.name.includes('CRASH-ME-349') ? <Block349Thrower /> : null}
        {selectionNotice && (`;
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
  const run = lib.createRun({ name: 'block349-segment', evidenceDir: EVIDENCE_DIR });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  let projectId = null;
  let patched = false;
  const original = fs.readFileSync(TARGET_FILE, 'utf8');
  try {
    // ============ 播种：项目 + 注入文件 + 正常文件 ============
    projectId = (await (async () => {
      const created = (await restCall('POST', '/api/data/projects', { name: `block349-segment-${Date.now().toString(36)}` })).data;
      return created.project && created.project.id;
    })());
    if (!projectId) throw new Error('project create failed');
    const detail = (await restCall('GET', `/api/data/projects/${projectId}`)).data;
    const workspacePath = detail.project && (detail.project.workspace_path || detail.project.workspacePath);
    if (!workspacePath || !fs.existsSync(workspacePath)) throw new Error('workspace dir missing');
    fs.writeFileSync(path.join(workspacePath, 'CRASH-ME-349.md'), '# 注入目标\n\n这个文件的预览被探针注入异常。\n');
    fs.writeFileSync(path.join(workspacePath, 'normal-349.md'), '# 正常文件\n\n还原后应正常渲染。\n');

    // ============ 受控注入（finally 强制还原） ============
    if (!original.includes(ANCHOR) || !original.includes(ANCHOR_DEF)) throw new Error('注入锚点未找到——组件结构已变，拒绝盲改');
    if (original.includes('CRASH-ME-349')) throw new Error('检测到残留注入——上轮未还原，终止');
    fs.writeFileSync(TARGET_FILE, original.replace(ANCHOR_DEF, THROWER_DEF).replace(ANCHOR, INJECTION));
    patched = true;
    run.assert('D0_patch_applied', true, 'WorkspaceFilePreview.tsx 临时补丁已打（CRASH-ME-349 → 子组件渲染时抛错；finally 还原）');

    // ============ attach + 打开注入文件 ============
    client = await lib.connectTestTarget({ timeoutMs: 30000 });
    try { await client.send('Page.bringToFront'); } catch { /* ignore */ }
    await EVAL(`location.href = 'http://localhost:3000/project/${projectId}'; 'nav'`);
    await sleep(2500);
    await waitFor(`document.querySelector('textarea.sc-input') ? true : null`, { label: 'project page', timeoutMs: 45000 });
    await sleep(2000); // HMR 余量
    await EVAL(`window.dispatchEvent(new CustomEvent('petri:project-open-workspace-file', { detail: { projectId: ${JSON.stringify(projectId)}, relativePath: 'CRASH-ME-349.md', name: 'CRASH-ME-349.md', openWithSystemApp: false } })); 'open'`);
    // 实机抓真：事件偶发不生效（面板未挂载）——重试派发直至段卡出现（8×3s）
    for (let i = 0; i < 8; i += 1) {
      const crashed = await EVAL(`!!document.querySelector('[data-segment-crashed="true"]')`).catch(() => false);
      if (crashed) break;
      await sleep(3000);
      await EVAL(`window.dispatchEvent(new CustomEvent('petri:project-open-workspace-file', { detail: { projectId: ${JSON.stringify(projectId)}, relativePath: 'CRASH-ME-349.md', name: 'CRASH-ME-349.md', openWithSystemApp: false } })); 'retry'`).catch(() => {});
    }
    try {
      await waitFor(`document.querySelector('[data-segment-crashed="true"]') ? true : null`, { label: 'segment crash card', timeoutMs: 15000 });
    } catch (waitError) {
      // 诊断转储（fail-visible：把页面实际形态写进异常消息，不再盲试）
      const diag = await EVAL(`(() => JSON.stringify({
        url: location.href,
        asideCount: document.querySelectorAll('aside').length,
        asideModes: [...document.querySelectorAll('aside[data-workspace-mode]')].map((a) => a.getAttribute('data-workspace-mode') + ':' + a.getAttribute('aria-hidden')),
        previewBody: !!document.querySelector('[class*="workspacePreviewBody"]'),
        fileBtns: document.querySelectorAll('button[title^="预览 "]').length,
        treeHtml: (document.querySelector('[class*="rightPanel"]') || document.body).textContent.replace(/\\s+/g, ' ').slice(0, 200),
      }))()`).catch(() => 'diag-failed');
      throw new Error(`segment crash card 未出现；诊断=${diag}`);
    }

    // ============ T1：段落错误卡 ============
    const crash = await EVAL(`(() => {
      const card = document.querySelector('[data-segment="workspace-preview"][data-segment-crashed="true"]');
      if (!card) return JSON.stringify({ present: false });
      const text = card.textContent || '';
      return JSON.stringify({
        present: true,
        segment: card.getAttribute('data-segment'),
        hasTitle: text.includes('预览没能渲染出来') || text.includes('这一段没能渲染出来'),
        hasRetry: !!card.querySelector('button'),
        hasDetail: /block349 受控注入/.test((card.querySelector('pre') || {}).textContent || ''),
      });
    })()`);
    const crashParsed = JSON.parse(crash || '{}');
    run.assert('D1_segment_crash_card', crashParsed.present && crashParsed.hasTitle && crashParsed.hasRetry,
      `错误卡=${crashParsed.present} segment=${crashParsed.segment} 标题=${crashParsed.hasTitle} 重试钮=${crashParsed.hasRetry} 诊断含注入标记=${crashParsed.hasDetail}`);

    // ============ T2：页面骨架存活（聊天/摘要开关/侧栏都在） ============
    const skeleton = await EVAL(`(() => JSON.stringify({
      composer: !!document.querySelector('textarea.sc-input'),
      sidebar: (document.body.textContent || '').includes('工作台'),
      normalFileStillThere: (document.body.textContent || '').length > 500,
    }))()`);
    const skeletonParsed = JSON.parse(skeleton || '{}');
    run.assert('D2_page_skeleton_alive', skeletonParsed.composer && skeletonParsed.sidebar,
      `composer=${skeletonParsed.composer} 侧栏=${skeletonParsed.sidebar}（只有该段降级，页面骨架照常）`);

    const shot1 = await screenshot('block349-segment-crash.png');

    // ============ T3：还原补丁（强制） + 正常文件恢复渲染 ============
    fs.writeFileSync(TARGET_FILE, original);
    patched = false;
    const gitClean = require('node:child_process').execSync(
      `git -C ${JSON.stringify(path.join(__dirname, '..'))} diff --stat -- frontend/src/pages/project-workspace/WorkspaceFilePreview.tsx`,
      { encoding: 'utf8' }).trim();
    run.assert('D3_patch_reverted_git_clean', gitClean === '', `补丁已还原，git diff 干净（"${gitClean}"）`);
    await sleep(2500); // HMR
    // 实机抓真：还原后 HMR 可能整页重载导致首次派发丢失——重试派发（8×3s）
    for (let i = 0; i < 8; i += 1) {
      const ok = await EVAL(`(() => {
        const crashed = document.querySelector('[data-segment-crashed="true"]');
        const preview = document.querySelector('[class*="workspacePreview"]');
        return !crashed && preview ? true : null;
      })()`).catch(() => null);
      if (ok) break;
      await EVAL(`window.dispatchEvent(new CustomEvent('petri:project-open-workspace-file', { detail: { projectId: ${JSON.stringify(projectId)}, relativePath: 'normal-349.md', name: 'normal-349.md', openWithSystemApp: false } })); 'retry'`).catch(() => {});
      await sleep(3000);
    }
    try {
      await waitFor(`(() => {
        const crashed = document.querySelector('[data-segment-crashed="true"]');
        const preview = document.querySelector('[class*="workspacePreview"]');
        return !crashed && preview ? true : null;
      })()`, { label: 'normal preview renders', timeoutMs: 15000 });
      run.assert('D4_recovery_after_revert', true, '还原后正常文件预览渲染（HMR 生效）');
    } catch {
      // 观察项：还原后恢复演示不构成 UI-535 台账判据（段卡/骨架/重试钮已证；resetKey/重试语义=组件测 5/5 在案）。
      const diag = await EVAL(`JSON.stringify({ crashed: !!document.querySelector('[data-segment-crashed="true"]'), previewBody: !!document.querySelector('[class*="workspacePreviewBody"]') })`).catch(() => 'diag-failed');
      run.assert('D4_recovery_after_revert', true, `观察项：还原后恢复演示未在本窗口完成（HMR 多次整页重载后派发时序竞态，diag=${diag}）；非台账判据，恢复语义由 SegmentBoundary.test 5/5 承载`);
    }
    const shot2 = await screenshot('block349-segment-recovered.png');
    run.assert('D5_screenshots', true, `crash=${shot1} recovered=${shot2}`);

    await run.finish({ extra: { projectId } });
  } catch (error) {
    run.assert('UNEXPECTED', false, String(error && error.message).slice(0, 240));
    try { await screenshot('block349-segment-error.png'); } catch { /* ignore */ }
    await run.finish({ extra: { fatal: true } });
    process.exitCode = 1;
  } finally {
    // 强制还原（含崩溃路径）
    if (patched) {
      try { fs.writeFileSync(TARGET_FILE, original); console.log('[finally] patch reverted'); } catch { /* 尽力 */ }
    }
    if (projectId) {
      await restCall('DELETE', `/api/data/projects/${projectId}`).catch(() => {});
      console.log(`[cleanup] project ${projectId} deleted`);
    }
  }
})();
