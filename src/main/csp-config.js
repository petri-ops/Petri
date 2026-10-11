// ============================================================
// CSP configuration
//
// Extracted from src/main.js by SUB-15.1 PHASE 1.
// Original location: src/main.js L683-716 (setupCsp).
//
// Low-risk: reads session.defaultSession only, no shared mutable
// state. mainWindow is passed via parameter injection.
// ============================================================

const { session, webContents } = require("electron");
const { SCHEME: GEN_UI_SCHEME } = require("./gen-ui/scheme");

function setupCsp({ isDevMode }) {
  // BLOCK-166 P3（实机渗透实证，勿回退）：gen-ui 沙箱页自身导航在网络栈层阻断。
  // CSP frame-src 只约束「嵌入子框架的 src」，frame 自身 location 赋值不受它管；
  // will-navigate / will-frame-navigate 对 OOPIF 均不派发（Electron 实测）——
  // OOPIF 导航请求必经 webRequest：发起者 webContents 的 URL 在 petri-genui: 上、
  // 目标是框架导航（mainFrame/subFrame）且目标非 petri-genui 自身 → 一律取消。
  // 规格 §6.5「页面内导航一律阻断」。页内 #fragment 跳转走 scrollIntoView 不发请求。
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = String(details.url || "");
    if (url.startsWith(`${GEN_UI_SCHEME}:`) || url.startsWith("blob:") || url.startsWith("data:")) {
      callback({});
      return;
    }
    if (details.resourceType === "mainFrame" || details.resourceType === "subFrame") {
      // P3 诊断：观察 OOPIF 导航请求的真实 details 形态（定位后收窄）
      if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
        console.log(
          "[security][p3-diag] frame-nav req:",
          JSON.stringify({
            resourceType: details.resourceType,
            webContentsId: details.webContentsId,
            referrer: String(details.referrer || "").slice(0, 50),
            frameUrl: (() => { try { return String(details.frame && details.frame.url || "").slice(0, 50); } catch { return "n/a"; } })(),
            url: url.slice(0, 60),
          }),
        );
      }
      if (typeof details.webContentsId === "number") {
        try {
          const wc = webContents.fromId(details.webContentsId);
          if (wc && !wc.isDestroyed() && String(wc.getURL() || "").startsWith(`${GEN_UI_SCHEME}:`)) {
            callback({ cancel: true });
            console.log("[security] gen-ui 沙箱导航已阻断(webRequest):", url.slice(0, 80));
            return;
          }
        } catch { /* webContents 已销毁则放行给其余策略 */ }
      }
    }
    callback({});
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // Gen UI 沙箱页自带 per-response CSP（csp.js 全禁面，规格 §6.1）：
    // 应用级 CSP 不得覆盖它；frame-src 对父页放行 petri-genui: 供 iframe 加载。
    if (String(details.url || "").startsWith(`${GEN_UI_SCHEME}:`)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const scriptSrc = isDevMode
      ? "script-src 'self' 'unsafe-inline'; "
      : "script-src 'self'; ";
    const localNet = isDevMode
      ? "http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* "
      : "http://localhost:* ws://localhost:* ";
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; " +
            scriptSrc +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' data: blob: http://localhost:* ; " +
            "connect-src 'self' " + localNet + "; " +
            "frame-src 'self' " + localNet + " " + GEN_UI_SCHEME + ":; " +
            "font-src 'self' data: ; " +
            "worker-src 'self' blob: ; " +
            "object-src 'none';",
        ],
      },
    });
  });
  console.log(
    isDevMode
      ? "[desktop] CSP dev mode (Vite React refresh inline preamble allowed; 127.0.0.1:* whitelisted; petri-genui: frame allowed)"
      : "[desktop] CSP hardened (unsafe-eval disabled)",
  );
}

module.exports = { setupCsp };
