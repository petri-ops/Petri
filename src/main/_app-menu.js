// ============================================================
// Application menu (macOS only)
//
// Extracted from src/main.js by SUB-15.1 PHASE 2.
// Original location: L926-998 (setupAppMenu).
//
// Registers the macOS application menu with fullscreen toggle
// accelerator (Cmd+Ctrl+F) and the standard Edit / View / Window
// menus. Electron APIs (app, BrowserWindow, Menu) are injected
// via parameters so the module has no top-level Electron dependency.
// ============================================================

/**
 * Build and set the macOS application menu.
 *
 * @param {object} deps
 * @param {import('electron').app}           deps.app            — Electron app
 * @param {import('electron').BrowserWindow} deps.BrowserWindow  — Electron BrowserWindow
 * @param {import('electron').Menu}         deps.Menu           — Electron Menu
 * @param {object} deps.process             — global Node process object
 */
function setupAppMenu({ app, BrowserWindow, Menu, process }) {
  if (process.platform !== "darwin") return;

  const _toggleFullscreen = () => {
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return;
    if (process.platform === "darwin") {
      win.setSimpleFullScreen(!win.isSimpleFullScreen());
    } else {
      win.setFullScreen(!win.isFullScreen());
    }
  };

  const template = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          label: "Enter Full Screen",
          accelerator: "Cmd+Ctrl+F",
          click: _toggleFullscreen,
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = { setupAppMenu };
