#!/usr/bin/env node
/**
 * BLOCK-322 聊天产物卡实机证据（UI-652）。
 *
 * 在运行中的 dev Electron 主窗（CDP 9222，只读：不导航、不写用户数据）挂载一次
 * 真实 `ConversationTimeline`（离屏隐藏容器，结束即卸载），用真实后端
 * `/api/tools/status/:jobId` 与真实产物验证：
 *   A1 落定折叠态出现运行摘要行（.sc-run-fold-line）
 *   A2 折叠态仍渲染产物卡（chat-artifact-card）——修复前此处直接不可达
 *   A3 渲染图数量 > 0
 *   A4 首图真实加载（naturalWidth>0）
 *   A5 3D 预览入口存在
 *   A6 挂载期间无 window error / unhandledrejection
 *
 * 前置：dev 栈在跑（Vite :3000 + 后端 :3001 或主进程自选端口）+ 主窗 CDP 9222。
 * 用法：node scripts/block322-chat-artifact-live.mjs
 *      BLOCK322_EXPORT_JOB=tj_xxx BLOCK322_PROJECT_ID=p_xxx PETRI_DEBUG_PORT=9222
 */
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lib = require(path.join(ROOT, '.agents/skills/petri-dev-infra/dev-verify/lib.cjs'));

const PORT = process.env.PETRI_DEBUG_PORT || '9222';
const JOB_ID = process.env.BLOCK322_EXPORT_JOB || 'tj_mvwm1rkk_6shi';
const PROJECT_ID = process.env.BLOCK322_PROJECT_ID || 'p_mvtu0b52_9cbr';
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-322-p3');

const PROBE = `(async () => {
  const tick = () => new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
  });
  const out = {};
  const errors = [];
  const onError = (event) => errors.push(String(event.message || event.reason || event));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  const ReactMod = await import('/@id/react');
  const React = ReactMod.default || ReactMod;
  const ReactDOMClientMod = await import('/@id/react-dom/client');
  const ReactDOMClient = ReactDOMClientMod.default || ReactDOMClientMod;
  const { ConversationTimeline } = await import('/src/components/copilot/ConversationTimeline.tsx');
  const host = document.createElement('div');
  host.id = 'petri-artifact-probe';
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;';
  document.body.appendChild(host);
  const segment = {
    kind: 'tools',
    iteration: 1,
    activities: [{
      key: 'probe-export-1',
      name: 'model3d_export',
      status: 'success',
      toolJobId: ${JSON.stringify(JOB_ID)},
      actionLabel: '已导出 3D 模型',
      iteration: 1,
    }],
    groups: [],
    totalCount: 1,
    failedCount: 0,
    runningCount: 0,
    durationMs: 5,
    state: 'settled',
  };
  const root = ReactDOMClient.createRoot(host);
  root.render(React.createElement(ConversationTimeline, { segments: [segment], projectId: ${JSON.stringify(PROJECT_ID)} }));
  const base = (window.petriDesktop && window.petriDesktop.backendConfig && window.petriDesktop.backendConfig.rApiBase) || 'http://localhost:3001/api';
  out.apiBase = base;
  out.fetchStatus = (await fetch(base + '/tools/status/' + encodeURIComponent(${JSON.stringify(JOB_ID)}), {
    headers: { Authorization: 'Bearer desktop-local' },
  })).status;
  // 后台窗口会节流 setTimeout/rAF；用 MessageChannel 让出事件循环（不受节流）。
  let card = null;
  for (let index = 0; index < 50 && !card; index += 1) {
    await tick();
    card = host.querySelector('[data-testid="chat-artifact-card"]');
  }
  out.foldLine = Boolean(host.querySelector('.sc-run-fold-line'));
  out.card = Boolean(card);
  out.cardText = card ? (card.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80) : null;
  out.images = card ? card.querySelectorAll('img').length : 0;
  out.has3DToggle = card ? (card.textContent || '').indexOf('展开 3D 预览') >= 0 : false;
  if (card && card.querySelector('img')) {
    const img = card.querySelector('img');
    try { await img.decode(); } catch { /* decode rejects on load error */ }
    out.imageLoaded = img.naturalWidth > 0 ? [img.naturalWidth, img.naturalHeight] : null;
    out.firstImageSrc = img.src;
  }
  out.errors = errors.slice(0, 3);
  window.removeEventListener('error', onError);
  window.removeEventListener('unhandledrejection', onError);
  try { root.unmount(); } catch { /* probe must not leak */ }
  host.remove();
  return JSON.stringify(out);
})()`;

async function main() {
  const run = lib.createRun({ name: 'block322-chat-artifact', evidenceDir: EVIDENCE_DIR });
  const targets = await lib.pollTargets({ port: PORT, timeoutMs: 20_000 });
  const target = targets.find((item) => item.type === 'page' && /localhost:3000|127\.0\.0\.1:3000/.test(item.url));
  run.assert('A0_main_window_target', Boolean(target), target ? target.url : 'no localhost:3000 page target');
  if (!target) return finish(run);

  const client = await lib.connectTarget(target);
  let probe = null;
  try {
    probe = JSON.parse(await lib.evalJs(client, PROBE, 60_000));
  } catch (error) {
    run.assert('A0_probe_evaluated', false, error.message);
    return finish(run, client);
  }
  run.assert('A1_settled_fold_line', probe.foldLine === true, String(probe.foldLine));
  run.assert('A2_artifact_card_rendered', probe.card === true, probe.cardText || 'card missing');
  run.assert('A3_status_rest_ok', probe.fetchStatus === 200, `status=${probe.fetchStatus} apiBase=${probe.apiBase}`);
  run.assert('A4_rendered_images', (probe.images || 0) > 0, `images=${probe.images}`);
  run.assert('A5_first_image_loaded', Array.isArray(probe.imageLoaded) && probe.imageLoaded[0] > 0, JSON.stringify(probe.imageLoaded));
  run.assert('A6_3d_entry_visible', probe.has3DToggle === true, String(probe.has3DToggle));
  run.assert('A7_no_window_errors', Array.isArray(probe.errors) && probe.errors.length === 0, JSON.stringify(probe.errors));
  return finish(run, client, probe);
}

async function finish(run, client, probe) {
  if (client) {
    try { client.socket.close(); } catch { /* already closed */ }
  }
  const payload = await run.finish({ probe: probe || null, jobId: JOB_ID, projectId: PROJECT_ID });
  process.exitCode = payload.allPass ? 0 : 1;
}

main().catch((error) => {
  console.error('FAILED:', error.message);
  process.exitCode = 1;
});
