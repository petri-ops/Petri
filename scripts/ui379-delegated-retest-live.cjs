#!/usr/bin/env node
'use strict';

/**
 * UI-379 delegated user retest (用户裁决「你来」委托 Agent 代跑).
 *
 * Prerequisite: dev stack running with CDP (`PETRI_DEV_ELECTRON_ARGS=--remote-debugging-port=9222 npm run dev`).
 *
 * User-view acceptance of the two React hooks-order fixes:
 *   ① 首启/欢迎页整页空白（DesktopOnboarding 早退排在 hooks 前）
 *   ② 项目页白屏（ProjectWorkspace 运行时横幅 hooks 排在 loading 早退后，
 *      深链整页加载 /project/:id 是原始触发形态）
 *
 * Evidence: acceptance/ui-379/ (screenshots + bounded assertions JSON).
 */

const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));

const REPO = lib.findRepoRoot(__dirname);
const EVIDENCE_DIR = path.join(REPO, 'acceptance', 'ui-379');
const RENDERER = 'http://localhost:3000';
const PROJECT_ID = process.argv[2] || 'p_mtw8183q_2txr';

let runFinished = false;
setTimeout(() => { if (!runFinished) { lib.log('global watchdog: aborting stuck run'); process.exit(3); } }, 120_000).unref();

async function waitUntil(fn, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await fn();
      if (last) return last;
    } catch (error) {
      last = error && error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function connectMainWindow(urlPattern = /^http:\/\/localhost:3000/) {
  const targets = await lib.pollTargets({ port: 9222, timeoutMs: 15_000 });
  const candidates = lib.filterPageTargets(targets, urlPattern);
  if (candidates.length === 0) return null;
  return lib.connectTarget(candidates[0]);
}

async function navigateAndSettle(url, settleCheck) {
  // 导航会重建执行上下文：只对旧 client 派发，随后一律重连新 client。
  const sender = await connectMainWindow();
  if (!sender) throw new Error(`no renderer target to navigate from (want ${url})`);
  await lib.evalJs(sender, `location.href = ${JSON.stringify(url)}`);
  return waitUntil(async () => {
    const next = await connectMainWindow();
    if (!next) return null;
    const state = await lib.evalJs(next, `({ url: location.href, ready: document.readyState })`);
    if (!state.url.startsWith(url.split('?')[0]) || state.ready !== 'complete') return null;
    const extra = await settleCheck(next);
    return extra ? { client: next, state, ...extra } : null;
  }, `settle at ${url}`, 45_000);
}

async function main() {
  const run = lib.createRun({ name: 'ui379-delegated-retest', evidenceDir: EVIDENCE_DIR });

  // ① 欢迎页：整页加载后 #root 必须已渲染（整树卸载 = 空根）
  const welcome = await navigateAndSettle(`${RENDERER}/`, async (client) => {
    const state = await lib.evalJs(client, `
      (() => {
        const root = document.querySelector('#root');
        return {
          rootChildren: root ? root.children.length : -1,
          bodyTextLen: (document.body.innerText || '').replace(/\\s+/g, '').length,
        };
      })()
    `);
    return state.rootChildren > 0 && state.bodyTextLen > 20 ? { welcome: state } : null;
  });
  run.assert('welcome: #root rendered (not unmounted)', welcome.welcome.rootChildren > 0, `children=${welcome.welcome.rootChildren}`);
  run.assert('welcome: body has visible copy', welcome.welcome.bodyTextLen > 20, `textLen=${welcome.welcome.bodyTextLen}`);
  await lib.screenshotPng(welcome.client, EVIDENCE_DIR, 'ui379-retest-welcome.png');

  // ② 项目页深链：整页加载 /project/:id，等 loading→loaded 翻转（hooks 计数漂移点）
  const project = await navigateAndSettle(`${RENDERER}/project/${PROJECT_ID}`, async (client) => {
    const state = await lib.evalJs(client, `
      (() => {
        const root = document.querySelector('#root');
        const text = document.body.innerText || '';
        return {
          rootChildren: root ? root.children.length : -1,
          loading: text.includes('加载项目中'),
          bodyTextLen: text.replace(/\\s+/g, '').length,
        };
      })()
    `);
    return state.rootChildren > 0 && !state.loading && state.bodyTextLen > 40 ? { project: state } : null;
  });
  run.assert('project: #root rendered after loading flip', project.project.rootChildren > 0, `children=${project.project.rootChildren}`);
  run.assert('project: left loading state (hooks-count flip survived)', project.project.loading === false);
  run.assert('project: workspace has real copy', project.project.bodyTextLen > 40, `textLen=${project.project.bodyTextLen}`);
  await lib.screenshotPng(project.client, EVIDENCE_DIR, 'ui379-retest-project.png');

  runFinished = true;
  const payload = await run.finish({
    provenance: 'user ruled 「你来」 delegating this retest to the session; dev Electron real stack, real full-page navigations',
    fixes: ['UI-379 ① welcome blank (DesktopOnboarding hooks order)', 'UI-379 ② project white (ProjectWorkspace runtime banner hooks order)'],
  });
  process.exitCode = payload.allPass ? 0 : 1;
}

main().catch((error) => {
  lib.log(error && error.stack ? error.stack : String(error));
  process.exitCode = 1;
});
