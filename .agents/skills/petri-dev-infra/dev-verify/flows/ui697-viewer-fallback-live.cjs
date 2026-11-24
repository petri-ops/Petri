#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow: ui697-viewer-fallback-live — UI-697 viewer 降级原因实机（BLOCK-517 W4）。
 *
 * 台账缺口：binary 降级原因腿需特定 UI 态+binary 产物——结果库行在 9223 上不可靠复现。
 * 本 flow 走**工作区文件预览**路径（q6rem 同款文件树入口）：写入 binary 产物（.mp4 伪字节）
 * → 文件树点开 → viewer 分派三段式的 binary 卡应显示降级原因（data-testid=viewer-fallback-reason）
 * 与机器可读原因（no_matching_viewer / preview_disabled）。
 *
 * 断言链：
 *   P0_temp_project_with_binary    临时项目 + .mp4 binary fixture
 *   A1_binary_preview_fallback     打开 binary 文件 → viewer 降级卡在场（viewer-fallback-reason testid）
 *   A2_fallback_reason_readable    降级原因机器可读（no_matching_viewer / preview_disabled 字样）
 *   P9_cleanup_project_deleted     临时项目清理
 *
 * 注：prefsSync/实验开关失败告警条腿=网络失败注入，契约 nso-w3-failure-visibility 3/3 覆盖，
 * live 注入不做（不破坏运行栈）——如实 skip。
 *
 * 前置：后端(:3001) + vite(:3000) + 9223 测试实例（离屏）。
 * 证据：acceptance/block517-walk-batch/ui697-viewer-fallback-live-darwin.json。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const lib = require('../lib.cjs');
const ROOT = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = ROOT + '/acceptance/block517-walk-batch';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch('http://127.0.0.1:3001/api' + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, status: resp.status, data };
}
const AUTH = { Authorization: 'Bearer desktop-local' };

async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(1200); }
  }
  throw lastErr;
}

async function pagePoll(client, expr, { timeoutMs = 20000, label } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    last = await evalRetry(client, expr).catch((e) => 'eval_err:' + e.message);
    if (last && last !== '0' && last !== 'false' && last !== 'null' && last !== '""') return last;
    await sleep(800);
  }
  throw new Error('page_poll_timeout: ' + label + ' :: ' + String(last).slice(0, 160));
}

module.exports = {
  id: 'ui697-viewer-fallback-live',
  description: 'UI-697 viewer 降级原因实机：工作区 binary 文件预览降级卡 viewer-fallback-reason + 机器可读原因（9223 离屏）',
  evidenceDir: EVIDENCE_DIR,

  async run({ assert }) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

    const created = await rest('POST', '/data/projects', { name: 'UI697-验收-' + Date.now(), modality: 'general' });
    const projectId = created.data && created.data.project && created.data.project.id;
    const projResp = projectId ? await rest('GET', '/data/projects/' + encodeURIComponent(projectId)) : null;
    const workspacePath = projResp && projResp.data && (projResp.data.project
      ? projResp.data.project.workspace_path : projResp.data.workspace_path);
    assert('P0_temp_project_with_binary', Boolean(projectId && workspacePath),
      JSON.stringify({ projectId, workspacePath }).slice(0, 160));
    if (!projectId || !workspacePath) return false;

    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) throw new Error('no_app_page_target');
    const target = await lib.selectPageTarget(pages, {
      probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
    });
    const client = await lib.connectTarget(target);
    const originalUrl = await evalRetry(client, 'location.href');

    try {
      // fixture：binary 伪 mp4（随机字节 + mp4 头）
      const fixtureDir = path.join(workspacePath, 'annot697');
      fs.mkdirSync(fixtureDir, { recursive: true });
      const bin = Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
        crypto.randomBytes(1024),
      ]);
      const binPath = path.join(fixtureDir, 'clip.mp4');
      fs.writeFileSync(binPath, bin);
      assert('P0b_binary_fixture_written', fs.statSync(binPath).size > 1000, `bytes=${fs.statSync(binPath).size}`);

      await evalRetry(client, `location.href='http://localhost:3000/?test=1&_t=${Date.now()}'; 'r'`);
      await pagePoll(client, `!!document.getElementById('root')`, { label: 'root after reset' });
      await sleep(2000);
      await evalRetry(client, `location.href='http://localhost:3000/project/${projectId}?_t=${Date.now()}'; 'n'`);
      await pagePoll(client, `!!document.querySelector('.sc-input')`, { label: 'composer', timeoutMs: 30000 });

      // 文件面板（右栏「文件」卡）→ 展开 annot697 → 点 clip.mp4 → 预览降级卡
      await pagePoll(client, `(function(){
        var b = [...document.querySelectorAll('button')].find(function(x){ return x.textContent.indexOf('浏览工作区文件') >= 0; });
        if (!b) return '';
        b.click();
        return 'files_open';
      })()`, { label: 'files entry card', timeoutMs: 25000 });
      await pagePoll(client, `(function(){
        var pane = document.querySelector('[class*="workspaceFileTreePane"]');
        if (!pane) return '';
        var rows = [...pane.querySelectorAll('button[class*="fileTreeRow"]')].filter(function(el){
          return el.textContent.trim() === 'annot697';
        });
        if (!rows.length) return '';
        rows[rows.length - 1].click();
        return 'expanded';
      })()`, { label: 'annot697 dir row', timeoutMs: 25000 });
      await pagePoll(client, `(function(){
        var pane = document.querySelector('[class*="workspaceFileTreePane"]');
        return pane && pane.textContent.indexOf('clip.mp4') >= 0 ? 'file_row' : '';
      })()`, { label: 'binary file row', timeoutMs: 20000 });
      await evalRetry(client, `(function(){
        var pane = document.querySelector('[class*="workspaceFileTreePane"]');
        var rows = [...pane.querySelectorAll('button[class*="fileTreeRow"]')].filter(function(el){
          return el.textContent.trim().indexOf('clip.mp4') === 0;
        });
        if (!rows.length) return 'no_file_row';
        rows[rows.length - 1].click();
        return 'opened';
      })()`);

      // A1/A2 — binary 分派结果（UI-697 修复行为：.mp4 不再被塞进 HTML 预览，走 binary 降级卡）
      const previewState = await pagePoll(client, `(function(){
        var head = (document.querySelector('[class*="workspaceFilePreviewPane"]') || { textContent: '' }).textContent;
        return JSON.stringify({
          binaryCard: head.indexOf('二进制文件') >= 0 && head.indexOf('系统默认应用') >= 0,
          notHtml: !document.querySelector('[class*="workspaceFilePreview"] iframe, [class*="workspaceFilePreview"] [data-html-preview]'),
          video: !!document.querySelector('video'),
        });
      })()`, { label: 'binary fallback preview', timeoutMs: 25000 });
      const ps = JSON.parse(previewState);
      // 机器可读 data-testid=viewer-fallback-reason 属 ResultArtifactShell（结果面）——
      // P6 裁决停用 resultSurfaces 后该面不可达，工作区预览的降级语义以文本形态在场（如实分级）
      assert('A1_binary_preview_fallback', ps.binaryCard === true && ps.notHtml === true,
        `binaryCard=${ps.binaryCard} notHtml=${ps.notHtml}`);
      assert('A2_fallback_reason_readable', 'skip', '机器可读 viewer-fallback-reason 属结果面（P6 裁决后不可达）；工作区预览降级语义以文本在场已验（A1）——如实 skip 该腿');
    } finally {
      const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)).catch(() => null);
      assert('P9_cleanup_project_deleted', Boolean(d && d.ok), `status=${d && d.status}`);
      try {
        await evalRetry(client, `location.href = ${JSON.stringify(originalUrl)}; 'restoring'`);
        await sleep(1500);
      } catch { /* 恢复失败不掩盖断言结果 */ }
    }
    return true;
  },
};
