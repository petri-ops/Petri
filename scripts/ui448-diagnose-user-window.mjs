// UI-448 v10 诊断 — 只读测量用户主窗口（9222）实际布局状态。
// 红线遵守：纯 Runtime.evaluate 读值 + Page.captureScreenshot 截图，
// 不导航、不点击、不改任何状态（dev-verify「探针禁导航用户窗口」）。
// 用法：node scripts/ui448-diagnose-user-window.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const lib = require('../.agents/skills/petri-dev-infra/dev-verify/lib.cjs');

const targets = await lib.pollTargets({ port: 9222, timeoutMs: 10000 });
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target on 9222: ' + JSON.stringify(targets.map((t) => t.url)));

const client = await lib.connectTarget(page);

const expr = `(() => {
  const rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) }; };
  const layout = document.querySelector("[class*='workspaceSessionLayout']");
  const dock = document.querySelector("[data-testid='side-chat-dock']");
  const surface = document.querySelector("[data-testid='side-chat-surface']");
  const handle = document.querySelector("[data-testid='side-chat-handle']");
  const summary = document.querySelector("[class*='workspacePinnedSummary']");
  const yieldEl = document.querySelector("[class*='agentMainSideChatYield']");
  const sumFloat = document.querySelector("[class*='workspaceSummaryFloat']");
  const sumCol = document.querySelector("[class*='workspaceSummaryColumn']");
  const centerCol = document.querySelector("main.centerCol, [class*='centerCol']");
  return {
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    url: location.href,
    summaryMode: sumFloat ? 'float' : (sumCol ? 'pinned' : 'closed'),
    dockOpen: !!surface,
    handleVisible: !!(handle && handle.offsetParent !== null),
    dockInsideLayout: !!(layout && dock && layout.contains(dock)),
    centerCol: rect(centerCol),
    layout: rect(layout),
    summaryRect: rect(summary),
    dockRect: rect(surface),
    handleRect: rect(handle),
    yieldPaddingRight: yieldEl ? getComputedStyle(yieldEl).paddingRight : null,
    sessionFrameWidth: (() => {
      const f = document.querySelector("[class*='workspaceSessionFrameChat']");
      return f ? Math.round(f.getBoundingClientRect().width) : null;
    })(),
    framePaddings: (() => {
      const f = document.querySelector("[class*='workspaceSessionFrameChat']");
      if (!f) return null;
      const cs = getComputedStyle(f);
      return { paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight };
    })(),
    codeMarkers: {
      surfaceRightComputed: surface ? getComputedStyle(surface).right : null,
      surfaceWidthComputed: surface ? getComputedStyle(surface).width : null,
      dockRootWidth: dock ? getComputedStyle(dock).width : null,
    },
  };
})()`;

let data;
try {
  data = await lib.evalJs(client, expr);
} catch (e) {
  console.error('eval failed:', e.message);
  process.exit(2);
}

console.log(JSON.stringify(data, null, 2));

try {
  await lib.screenshotPng(client, 'acceptance/ui-448', 'user-window-diagnostic');
  console.log('screenshot saved: acceptance/ui-448/user-window-diagnostic.png');
} catch (e) {
  console.log('screenshot failed (non-fatal):', e.message);
}

try { client.socket?.close(); } catch { /* ok */ }
process.exit(0);
