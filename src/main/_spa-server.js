// ============================================================
// SPA Static Server
//
// Extracted from src/main.js by SUB-15.1 PHASE 3.
// Original location: L149-196 (SPA server startup logic).
//
// Starts the Vite SPA static server in production mode.
// Development mode relies on the Vite dev server at rendererDevUrl.
// ============================================================

/**
 * Start the SPA static server and return the server URL.
 *
 * @param {object} deps
 * @param {function} deps.resolveResource - resolveResource(resource, subPath) from core-utils
 * @param {function} deps.isDevMode       - isDevMode() from core-utils
 * @param {function} deps.rendererDevUrl - rendererDevUrl from core-utils
 * @param {object}  deps.process         - Node.js process object (injected for env vars)
 * @returns {Promise<{spaServerUrl: string|null, spaIndexPath: string, isDevMode: boolean, rendererDevUrl: string}>}
 */
async function startSpaServer({ resolveResource, isDevMode, rendererDevUrl, process }) {
  // Vite SPA build location
  const spaBuildDir = resolveResource("frontend", "dist");
  const spaIndexPath = path.join(spaBuildDir, "index.html");
  let spaServerUrl = isDevMode ? rendererDevUrl : null;

  if (!isDevMode) {
    try {
      const { startStaticServer } = require("../static-server");
      const spaServer = await startStaticServer(spaBuildDir, {
        port: Number(process.env.PETRI_RENDERER_PORT || 3002),
        baseUrl: "/",
        label: "spa-server",
        spaFallback: true,
        fallbackToRandomPort: false,
      });
      const address = spaServer?.address();
      if (typeof address === "object" && address) {
        spaServerUrl = `http://localhost:${address.port}/`;
      }
    } catch (e) {
      console.warn("[desktop] SPA static server failed:", e.message);
    }
  }

  return { spaServerUrl, spaIndexPath };
}

const path = require("path");

module.exports = { startSpaServer };
