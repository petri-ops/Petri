// ============================================================
// CSP configuration
//
// Extracted from src/main.js by SUB-15.1 PHASE 1.
// Original location: src/main.js L683-716 (setupCsp).
//
// Low-risk: reads session.defaultSession only, no shared mutable
// state. mainWindow is passed via parameter injection.
// ============================================================

const { session } = require("electron");
const { SCHEME: GEN_UI_SCHEME } = require("./gen-ui/scheme");

function setupCsp({ isDevMode }) {
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
