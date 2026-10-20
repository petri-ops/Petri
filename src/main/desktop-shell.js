'use strict';

/**
 * desktop-shell.js — BLOCK-223 桌面外壳（主进程）。
 *
 * 职责只有三件，全部围绕「长跑可以离开窗口」：
 *   ① 系统通知网关：偏好/聚焦抑制/去重/点击聚焦；
 *   ② 托盘：closeToTray 时关窗=隐藏；菜单「显示主窗 / 退出 Petri」；
 *   ③ 退出协调器：有活动 → 渲染进程弹摘要（取消 / 最小化到托盘 / 停止并退出）；
 *      无活动或摘要不可读 → 直接退出；渲染进程不可用/超时 → 原生对话框兜底。
 *
 * 红线（plan §4）：
 *   - 退出守卫必须先于既有 before-quit 消费者注册（否则后端先被杀）；
 *   - 默认行为零变化：closeToTray=false / notifyOnTurnEnd=true；
 *   - 摘要只读，不做取消/停止动作；
 *   - 测试实例不弹真实 toast（返回 simulated_test_instance），避免打扰实机验收。
 */

const path = require('node:path');
const {
  DEFAULT_PREFS,
  parseShellPrefs,
  normalizeActivity,
  shouldShowQuitSummary,
  quitSummaryRows,
  notificationDecision,
  buildNotificationPayload,
} = require('./desktop-shell-model.js');

const SUMMARY_FETCH_TIMEOUT_MS = 2000;
const QUIT_DECISION_TIMEOUT_MS = 5000;

function createDesktopShell({
  app,
  getMainWindow,
  isTestInstance = false,
  getTerminalSessionCount = () => 0,
  resolveResource,
}) {
  let prefs = { ...DEFAULT_PREFS };
  let tray = null;
  let allowQuit = false;
  let quitRequestPending = false;
  let quitFlow = null; // { timer, preview }
  let lastNotification = { key: null, at: 0 };

  const backendPort = () => process.env.R_SERVER_PORT || '3001';

  function mainWindowAlive() {
    const win = getMainWindow();
    return Boolean(win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed());
  }

  function showMainWindow() {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return { ok: false, reason: 'window_unavailable' };
    try {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    } catch (error) {
      return { ok: false, reason: (error && error.message) || 'show_failed' };
    }
    return { ok: true };
  }

  function trayIconPath() {
    try {
      if (typeof resolveResource === 'function') {
        const resolved = resolveResource('icons', 'icon.png');
        if (resolved) return resolved;
      }
    } catch {}
    return path.join(__dirname, '..', '..', 'icons', 'icon.png');
  }

  function ensureTray() {
    if (tray) return true;
    try {
      const { Tray, Menu, nativeImage } = require('electron');
      const image = nativeImage.createFromPath(trayIconPath());
      const icon = image.isEmpty() ? nativeImage.createEmpty() : image.resize({ width: 16, height: 16 });
      tray = new Tray(icon);
      tray.setToolTip('Petri 格物');
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: '显示主窗', click: () => showMainWindow() },
        { type: 'separator' },
        { label: '退出 Petri', click: () => { void beginQuitFlow('tray-menu'); } },
      ]));
      tray.on('click', () => showMainWindow());
      return true;
    } catch (error) {
      tray = null;
      console.warn('[desktop-shell] tray unavailable:', (error && error.message) || error);
      return false;
    }
  }

  function destroyTray() {
    if (!tray) return;
    try { tray.destroy(); } catch {}
    tray = null;
  }

  function hideToTray() {
    const win = getMainWindow();
    const trayReady = ensureTray();
    if (!win || win.isDestroyed()) return { ok: false, reason: 'window_unavailable', trayActive: trayReady };
    if (!trayReady) return { ok: false, reason: 'tray_unavailable' };
    try {
      win.hide();
    } catch (error) {
      return { ok: false, reason: (error && error.message) || 'hide_failed' };
    }
    return { ok: true, trayActive: true };
  }

  function updatePrefs(patch) {
    const next = parseShellPrefs({ ...prefs, ...(patch && typeof patch === 'object' ? patch : {}) });
    const changed = next.closeToTray !== prefs.closeToTray || next.notifyOnTurnEnd !== prefs.notifyOnTurnEnd;
    prefs = next;
    if (prefs.closeToTray) ensureTray();
    else destroyTray();
    return { ok: true, changed, prefs: { ...prefs } };
  }

  async function fetchActivitySummary() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUMMARY_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`http://127.0.0.1:${backendPort()}/api/app/activity-summary`, {
        headers: { Authorization: 'Bearer desktop-local' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`activity_summary_http_${response.status}`);
      const body = await response.json();
      const merged = {
        ...body,
        counts: { ...(body && body.counts ? body.counts : {}) },
      };
      merged.counts.terminalSessions = Number(getTerminalSessionCount()) || 0;
      return normalizeActivity(merged);
    } catch (error) {
      return normalizeActivity({ counts: {}, degraded: true, error: (error && error.message) || 'summary_failed' });
    } finally {
      clearTimeout(timer);
    }
  }

  function notificationStatus() {
    try {
      const { Notification } = require('electron');
      return Boolean(Notification && typeof Notification.isSupported === 'function' && Notification.isSupported());
    } catch {
      return false;
    }
  }

  function notify(payload) {
    const win = getMainWindow();
    const alive = Boolean(win && !win.isDestroyed());
    const decision = notificationDecision({
      kind: payload && payload.kind,
      enabled: prefs.notifyOnTurnEnd,
      supported: notificationStatus(),
      focused: alive ? win.isFocused() : false,
      visible: alive ? win.isVisible() : false,
      minimized: alive ? win.isMinimized() : false,
      key: (payload && (payload.dedupeKey || payload.conversationId || payload.label)) || '',
      lastKey: lastNotification.key,
      lastAt: lastNotification.at,
      now: Date.now(),
    });
    if (!decision.show) return { shown: false, reason: decision.reason };
    const built = buildNotificationPayload(payload || {});
    if (!built) return { shown: false, reason: 'unsupported_kind' };

    lastNotification = { key: decision.key, at: Date.now() };
    if (isTestInstance) {
      return { shown: false, reason: 'simulated_test_instance', wouldShow: true, title: built.title };
    }
    try {
      const { Notification } = require('electron');
      const notification = new Notification({ title: built.title, body: built.body });
      notification.on('click', () => {
        showMainWindow();
        const target = getMainWindow();
        if (target && !target.isDestroyed()) {
          try {
            target.webContents.send('app:notification-clicked', {
              kind: payload && payload.kind,
              conversationId: (payload && payload.conversationId) || null,
            });
          } catch {}
        }
      });
      notification.show();
      return { shown: true };
    } catch (error) {
      return { shown: false, reason: (error && error.message) || 'notification_failed' };
    }
  }

  function sendToRenderer(channel, payload) {
    const win = getMainWindow();
    if (!win || win.isDestroyed() || !win.webContents || win.webContents.isDestroyed()) return false;
    try {
      win.webContents.send(channel, payload);
      return true;
    } catch {
      return false;
    }
  }

  function clearQuitFlow() {
    if (quitFlow && quitFlow.timer) clearTimeout(quitFlow.timer);
    quitFlow = null;
  }

  function approveAndQuit() {
    allowQuit = true;
    clearQuitFlow();
    try { app.quit(); } catch {}
  }

  function nativeQuitFallback(summary) {
    const preview = Boolean(quitFlow && quitFlow.preview);
    clearQuitFlow();
    if (preview) return;
    if (isTestInstance) {
      approveAndQuit();
      return;
    }
    try {
      const { dialog } = require('electron');
      const rows = summary && summary.total > 0 ? quitSummaryRows(summary.counts) : [];
      const detail = rows.length > 0
        ? rows.map((row) => `${row.label}：${row.value}`).join('\n')
        : '未能读取活动状态。';
      const options = {
        type: 'warning',
        buttons: ['取消', '停止并退出'],
        defaultId: 0,
        cancelId: 0,
        title: '退出 Petri',
        message: rows.length > 0 ? '仍有正在进行的活动' : '无法确认活动状态',
        detail,
      };
      const win = getMainWindow();
      const choice = win && !win.isDestroyed()
        ? dialog.showMessageBoxSync(win, options)
        : dialog.showMessageBoxSync(options);
      if (choice === 1) approveAndQuit();
    } catch {
      approveAndQuit();
    }
  }

  async function beginQuitFlow(reason) {
    if (allowQuit) return;
    if (quitFlow || quitRequestPending) return;
    if (!mainWindowAlive()) {
      approveAndQuit();
      return;
    }
    quitRequestPending = true;
    let summary = await fetchActivitySummary();
    quitRequestPending = false;
    if (allowQuit) return;
    const preview = reason === 'test-preview';
    // 预览腿：活动为零时也强制出弹窗（合成两行演示数据，弹窗内明确标注 preview）；
    // 真实退出路径绝不合成计数。
    if (preview && !shouldShowQuitSummary(summary)) {
      summary = normalizeActivity({ counts: { toolJobsRunning: 2, approvalsPending: 1 } });
    }
    if (!preview && (summary.degraded || !shouldShowQuitSummary(summary))) {
      approveAndQuit();
      return;
    }
    if (!mainWindowAlive()) {
      approveAndQuit();
      return;
    }
    // 测试实例窗口永久离屏（无可见窗口纪律）：弹窗/摘要走同一渲染进程，
    // 但绝不 show() 到屏幕上。
    if (!isTestInstance) showMainWindow();
    quitFlow = { timer: null, preview };
    const delivered = sendToRenderer('app:quit-requested', {
      ...summary,
      rows: quitSummaryRows(summary.counts),
      reason: reason || 'quit',
      preview,
      trayAvailable: Boolean(tray),
    });
    if (!delivered) {
      nativeQuitFallback(summary);
      return;
    }
    quitFlow.timer = setTimeout(() => nativeQuitFallback(summary), QUIT_DECISION_TIMEOUT_MS);
  }

  function respondQuit(action) {
    if (!quitFlow) return { ok: false, reason: 'no_pending_quit' };
    const preview = quitFlow.preview === true;
    if (action === 'cancel') {
      clearQuitFlow();
      return { ok: true, action: 'cancel', preview };
    }
    if (preview) {
      clearQuitFlow();
      return { ok: true, action: 'preview_only', preview: true };
    }
    if (action === 'tray') {
      const result = hideToTray();
      if (!result.ok) {
        // 托盘不可用/隐藏失败：保留待决 flow，让渲染侧继续显示摘要与错误。
        return { ok: false, action: 'tray', trayActive: Boolean(tray), reason: result.reason };
      }
      clearQuitFlow();
      return { ok: true, action: 'tray', trayActive: Boolean(tray) };
    }
    if (action === 'quit') {
      clearQuitFlow();
      approveAndQuit();
      return { ok: true, action: 'quit' };
    }
    return { ok: false, reason: 'invalid_action' };
  }

  function onBeforeQuit(event) {
    if (allowQuit) return;
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    void beginQuitFlow('before-quit');
  }

  function attachMainWindow(win) {
    if (!win || win.isDestroyed()) return;
    win.on('close', (event) => {
      if (allowQuit) return;
      if (prefs.closeToTray) {
        const result = hideToTray();
        if (result.ok) {
          if (event && typeof event.preventDefault === 'function') event.preventDefault();
          return;
        }
        // 托盘不可用：退回正常退出流程，不把窗口卡在“关了但没关”。
      }
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      void beginQuitFlow('window-close');
    });
  }

  function getStatus() {
    return {
      ok: true,
      closeToTray: prefs.closeToTray,
      notifyOnTurnEnd: prefs.notifyOnTurnEnd,
      trayActive: Boolean(tray),
      notificationsSupported: notificationStatus(),
      testInstance: isTestInstance,
    };
  }

  async function getActivitySummary() {
    const summary = await fetchActivitySummary();
    return { ok: !summary.degraded, ...summary };
  }

  function previewQuitSummary() {
    if (!isTestInstance) return { ok: false, reason: 'test_instance_only' };
    void beginQuitFlow('test-preview');
    return { ok: true };
  }

  function dispose() {
    clearQuitFlow();
    destroyTray();
  }

  return {
    installQuitGuard: () => app.on('before-quit', onBeforeQuit),
    attachMainWindow,
    updatePrefs,
    getStatus,
    getActivitySummary,
    notify,
    respondQuit,
    showMainWindow,
    hideToTray,
    previewQuitSummary,
    dispose,
  };
}

module.exports = { createDesktopShell };
