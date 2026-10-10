#!/usr/bin/env node
/**
 * BLOCK-123 P0 定点探针——审阅面（S6 涩点钉死）：
 * 播种 git 项目 + 直接制造工作区变更（不经模型）→ CDP 打开工作台 → 点击「审阅」tab →
 * 取证 tab 渲染后的 diff/accept/commit 控件是否存在。产出 p0-review-probe.json + 截图。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = require(path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const EVDIR = path.join(ROOT, 'acceptance', 'block-123');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, data };
}
async function evalRetry(client, expr, tries = 6) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try { return await lib.evalJs(client, expr); } catch (e) { lastErr = e; await sleep(500 * (i + 1)); }
  }
  throw lastErr;
}
function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20_000 }).trim();
}

let projectId = null;
let client = null;
let originalUrl = null;
try {
  fs.mkdirSync(EVDIR, { recursive: true });
  const created = await rest('POST', '/data/projects', { name: 'BLOCK123-审阅面-' + Date.now(), modality: 'general' });
  const project = created.data && (created.data.project || created.data);
  projectId = project && project.id;
  const detail = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
  const rawProject = (detail.data && detail.data.project) || project || {};
  const workspacePath = rawProject.workspace_path || rawProject.workspacePath;
  fs.writeFileSync(path.join(workspacePath, 'app.js'), "console.log('v1');\n");
  console.log('step: files written');
  git(workspacePath, ['init']);
  git(workspacePath, ['add', '.']);
  git(workspacePath, ['-c', 'user.name=p0-probe', '-c', 'user.email=probe@local', 'commit', '-m', 'baseline']);
  fs.writeFileSync(path.join(workspacePath, 'app.js'), "console.log('v2 — changed for review probe');\n");
  fs.writeFileSync(path.join(workspacePath, 'new-file.txt'), 'untracked file\n');
  console.log('seeded', projectId, workspacePath);

  const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
  const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  const target = await lib.selectPageTarget(pages, {
    probe: async (c) => lib.evalJs(c, '!!document.getElementById(\'root\')').catch(() => false),
  });
  client = await lib.connectTarget(target);
  originalUrl = target.url;
  await evalRetry(client, 'location.href = ' + JSON.stringify(APP_ORIGIN + '/project/' + encodeURIComponent(projectId)) + "; 'nav'");
  await sleep(4000);

  // 点击右侧面板「审阅」tab（按文本找元素）
  const clickResult = await evalRetry(client, `(function(){
    const els = [...document.querySelectorAll('button, [role="tab"], a, span, div')];
    const tab = els.find((el) => el.textContent.trim() === '审阅' && el.offsetParent !== null);
    if (!tab) return 'tab_not_found';
    tab.click();
    return 'clicked:' + tab.tagName + '.' + String(tab.className).slice(0, 60);
  })()`);
  console.log('review tab:', clickResult);
  await sleep(3000);

  const probe = await evalRetry(client, `(function(){
    const t = document.body.innerText;
    return JSON.stringify({
      hasDiffKeywords: ['变更', '修改', '差异', 'diff', '未跟踪', 'untracked'].filter((k) => t.indexOf(k) >= 0),
      hasAccept: t.indexOf('接受') >= 0 || t.indexOf('采纳') >= 0,
      hasReject: t.indexOf('驳回') >= 0 || t.indexOf('拒绝') >= 0,
      hasCommit: t.indexOf('提交') >= 0,
      hasNotGit: t.indexOf('不是 git') >= 0 || t.indexOf('非 git') >= 0,
      diffEls: document.querySelectorAll('[class*="diff" i], [class*="Diff"]').length,
      changedFiles: (t.match(/app\\.js/g) || []).length,
      excerpt: t.slice(0, 1200)
    });
  })()`);
  let p = {};
  try { p = JSON.parse(probe); } catch { /* keep */ }
  delete p.excerpt;
  console.log('review surface:', JSON.stringify(p, null, 2));
  fs.writeFileSync(path.join(EVDIR, 'p0-review-probe.json'), JSON.stringify({ projectId, clickResult, surface: p, at: new Date().toISOString() }, null, 2));
  fs.writeFileSync(path.join(EVDIR, 'p0-review-innertext.txt'), String(await evalRetry(client, 'document.body.innerText')));
  try { await lib.screenshotPng(client, EVDIR, 'p0-review-tab.png'); } catch { /* best effort */ }
} finally {
  const marks = [];
  if (projectId) { const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId)); marks.push('project=' + d.ok); }
  if (client && originalUrl) {
    try { await evalRetry(client, 'location.href = ' + JSON.stringify(originalUrl) + "; 'r'"); marks.push('restored'); } catch { marks.push('restore_failed'); }
  }
  console.log('cleanup:', marks.join(' '));
}
