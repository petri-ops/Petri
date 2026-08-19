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

function setupCsp({ isDevMode }) {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
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
            "frame-src 'self' " + localNet + "; " +
            "font-src 'self' data: ; " +
            "worker-src 'self' blob: ; " +
            "object-src 'none';",
        ],
      },
    });
  });
  console.log(
    isDevMode
      ? "[desktop] CSP dev mode (Vite React refresh inline preamble allowed; 127.0.0.1:* whitelisted)"
      : "[desktop] CSP hardened (unsafe-eval disabled)",
  );
}

module.exports = { setupCsp };
