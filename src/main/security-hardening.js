'use strict';

/**
 * SEC-HARDEN — 主进程安全加固（对齐 Electron 官方安全清单）
 *
 * 背景（AUDIT-LOG「代码复审余项 ③」的收口落地）：审计原话是
 * 「`main.js` webPreferences 未显式声明 sandbox/webSecurity（低，未动）…
 *   ③④ 与安全专项（**webview 加固、默认权限收紧**）留后续工作包」。
 * 复核现状：三个 BrowserWindow 均已显式声明
 * `contextIsolation: true / nodeIntegration: false / sandbox: true / webSecurity: true`
 * （`src/main/_window-create.js` / `src/ipc/window-manager.js` ×2）——字面项已满足；
 * 真正残留的是**附带的安全专项**，三处缺口全部对应官方清单条目：
 *
 *  - 清单 #5 `setPermissionRequestHandler` 缺失 → 官方文档原文：
 *    “By default, Electron will automatically approve all permission requests
 *     unless the developer has manually configured a custom handler.”
 *    本应用有一个加载**任意外部 URL** 的 `<webview>`（结果浏览器面板），
 *    等于任意站点可无提示拿到摄像头/麦克风/定位/通知/屏幕捕获等能力。
 *  - 清单 #11 `<webview allowpopups>` → 官方立场是「默认不应允许」；
 *    guest 可借 `window.open()` 自建 BrowserWindow。
 *  - 清单 #12 未校验 `<webview>` 的 webPreferences/params → 渲染层（含被注入的
 *    第三方页面）可创建带任意 `preload`/`partition` 的 webview。
 *
 * 本模块只做**收敛**，不引入新机制：
 *  - webview 附着前中和 webPreferences（删 preload、强制 sandbox/contextIsolation/
 *    nodeIntegration=false/webSecurity=true）、限定 partition 白名单、校验 src 协议。
 *  - 每个 webContents（含 webview guest）装 `setWindowOpenHandler`：一律 deny，
 *    http/https 交给系统浏览器（绝不由 guest 自建窗口）。
 *  - 权限策略：**默认拒绝**；仅自家受信渲染 origin（`BIOF3_TRUSTED_DESKTOP_ORIGINS`，
 *    由 `env-coordinator.setupDesktopEnv` 写入）放行本应用确实在用的两项
 *    （`clipboard-sanitized-write` = 复制按钮、`openExternal` = 外链走系统浏览器）。
 *
 * 边界：不触碰 IPC 发送方校验（BLOCK-10 S-004 `src/ipc/_sender-guard.js` 已有独立机制）、
 * 不改任何 BrowserWindow 的既有 webPreferences 取值、不动 CSP（`src/main/csp-config.js`）。
 */

const { URL } = require('node:url');

/** 允许承载 `<webview>` 的 session 分区白名单（唯一使用点：结果浏览器面板）。 */
const WEBVIEW_PARTITION_ALLOWLIST = Object.freeze(['persist:gewu-browser']);

/** 受信渲染 origin 允许申请的权限（本应用真实使用面）。 */
const TRUSTED_RENDERER_PERMISSIONS = Object.freeze(['clipboard-sanitized-write', 'openExternal']);

function safeOrigin(value) {
  try {
    return new URL(String(value || '')).origin;
  } catch {
    return '';
  }
}

function isHttpOrHttps(value) {
  try {
    const parsed = new URL(String(value || ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** 受信渲染 origin 集合（运行时载体：env-coordinator 写入的环境变量）。 */
function trustedOriginsFromEnv(env = process.env) {
  return String(env.BIOF3_TRUSTED_DESKTOP_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * 纯决策：是否放行某次权限申请。
 * @param {{permission: string, origin: string, trustedOrigins: string[]}} params
 */
function decidePermission({ permission, origin, trustedOrigins }) {
  const normalizedOrigin = safeOrigin(origin);
  if (!normalizedOrigin) return false;
  if (!trustedOrigins.includes(normalizedOrigin)) return false;
  return TRUSTED_RENDERER_PERMISSIONS.includes(String(permission || ''));
}

/**
 * 纯决策：`<webview>` 是否允许附着。
 * 中和（就地修改 webPreferences）与拦截判定分开返回，便于单测逐条断言。
 * @param {{webPreferences: object, params: object, allowedPartitions?: string[]}} input
 */
function verifyWebviewAttach({ webPreferences, params = {}, allowedPartitions = WEBVIEW_PARTITION_ALLOWLIST }) {
  const reasons = [];
  const prefs = webPreferences && typeof webPreferences === 'object' ? webPreferences : {};

  if (prefs.preload) {
    delete prefs.preload;
    reasons.push('stripped_preload');
  }
  if (prefs.preloadURL) {
    delete prefs.preloadURL;
    reasons.push('stripped_preload_url');
  }
  if (prefs.nodeIntegration !== false) {
    prefs.nodeIntegration = false;
    reasons.push('forced_node_integration_false');
  }
  if ('nodeIntegrationInSubFrames' in prefs && prefs.nodeIntegrationInSubFrames !== false) {
    prefs.nodeIntegrationInSubFrames = false;
    reasons.push('forced_node_integration_subframes_false');
  }
  if (prefs.contextIsolation !== true) {
    prefs.contextIsolation = true;
    reasons.push('forced_context_isolation_true');
  }
  if (prefs.sandbox !== true) {
    prefs.sandbox = true;
    reasons.push('forced_sandbox_true');
  }
  if (prefs.webSecurity === false) {
    prefs.webSecurity = true;
    reasons.push('forced_web_security_true');
  }
  if ('allowRunningInsecureContent' in prefs && prefs.allowRunningInsecureContent) {
    prefs.allowRunningInsecureContent = false;
    reasons.push('forced_allow_running_insecure_content_false');
  }

  const partition = params.partition ? String(params.partition) : '';
  if (partition && !allowedPartitions.includes(partition)) {
    return { allow: false, reason: 'partition_not_allowlisted', partition, mutations: reasons };
  }
  if (!isHttpOrHttps(params.src)) {
    return { allow: false, reason: 'src_not_http_or_https', src: String(params.src || ''), mutations: reasons };
  }
  return { allow: true, reason: 'hardened', mutations: reasons };
}

/**
 * 注册 `web-contents-created`（**必须在任何 webContents 创建之前调用**，即模块加载期）。
 * 覆盖主窗口与所有 `<webview>` guest。
 */
function applyWebContentsHardening({ app, shell, log = console } = {}) {
  if (!app || typeof app.on !== 'function') {
    throw new TypeError('applyWebContentsHardening requires the Electron app object');
  }
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const verdict = verifyWebviewAttach({ webPreferences, params });
      if (verdict.mutations.length > 0) {
        log.warn?.('[security] webview webPreferences 已中和:', verdict.mutations.join(','));
      }
      if (!verdict.allow) {
        log.warn?.('[security] 拒绝 webview 附着:', verdict.reason, verdict.partition || verdict.src || '');
        event.preventDefault();
      }
    });

    // 清单 #11：绝不让 guest（或任何 webContents）自建 BrowserWindow；
    // http(s) 一律交给系统浏览器，非 http(s) 直接丢弃。
    contents.setWindowOpenHandler(({ url }) => {
      if (isHttpOrHttps(url)) {
        try {
          shell?.openExternal?.(url)?.catch?.(() => {});
        } catch (error) {
          log.warn?.('[security] openExternal 失败:', error?.message || String(error));
        }
      }
      return { action: 'deny' };
    });
  });
}

/**
 * 权限策略（清单 #5）：默认拒绝 + 受信 origin 白名单放行。
 * 必须在 `app.whenReady()` 且 `setupDesktopEnv()` 之后调用（受信 origin 环境变量此时才存在）。
 *
 * 两个易踩的坑（实机验收抓出，勿回退）：
 *  1) **必须覆盖「所有加载远程内容的 session」**，不能只装 `defaultSession`：
 *     `<webview partition="persist:gewu-browser">` 用的是**分区 session**，只装默认 session
 *     时 guest 仍走 Electron 的「自动批准一切」——实测 guest 内 geolocation = granted。
 *     故除默认 session 外，另挂 `app.on('session-created')` 给此后创建的每个 session 装。
 *  2) **检查 handler 的 requestingOrigin 可能为空**（Chromium 对剪贴板写等检查不一定带来源），
 *     此时必须回退到 `webContents.getURL()` 判据，否则会把自家 UI 的复制按钮误杀
 *     （实测：只按 requestingOrigin 判 → `navigator.clipboard.writeText` 报 Write permission denied）。
 */
function applyPermissionPolicy({ session, app, env = process.env, log = console } = {}) {
  if (!session?.defaultSession) {
    throw new TypeError('applyPermissionPolicy requires the Electron session module');
  }
  const trustedOrigins = trustedOriginsFromEnv(env);
  if (trustedOrigins.length === 0) {
    log.warn?.('[security] BIOF3_TRUSTED_DESKTOP_ORIGINS 为空 → 权限策略将拒绝全部申请');
  }

  // 拒绝时按「权限@来源」去重打点，避免 webview 内页面探测时刷屏。
  const warned = new Set();
  const denyLog = (permission, origin) => {
    const key = `${permission}@${origin || 'unknown'}`;
    if (warned.has(key)) return;
    warned.add(key);
    log.warn?.(`[security] 权限拒绝: ${permission} origin=${origin || 'unknown'}`);
  };

  const installed = new Set();
  const installOn = (target) => {
    if (!target || installed.has(target)) return;
    installed.add(target);
    target.setPermissionRequestHandler((webContents, permission, callback) => {
      const origin = safeOrigin(webContents?.getURL?.()) || '';
      const allowed = decidePermission({ permission, origin, trustedOrigins });
      if (!allowed) denyLog(permission, origin);
      callback(allowed);
    });
    target.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
      // 坑 2：requestingOrigin 为空时回退到 webContents 的当前 URL；两者都取不到 → 拒绝。
      const origin = safeOrigin(requestingOrigin) || safeOrigin(webContents?.getURL?.()) || '';
      const allowed = decidePermission({ permission, origin, trustedOrigins });
      if (!allowed) denyLog(permission, origin);
      return allowed;
    });
  };

  installOn(session.defaultSession);
  // 坑 1：分区 session（webview）不覆盖 defaultSession，必须逐个装。
  app?.on?.('session-created', (created) => {
    installOn(created);
    log.warn?.(`[security] 已对新 session 装配权限策略（共 ${installed.size} 个）`);
  });

  // installedSessions 是活引用（不是快照），便于诊断与测试断言「后续新建的 session 也装上了」。
  return { trustedOrigins, installedSessions: installed, installOn };
}

module.exports = {
  WEBVIEW_PARTITION_ALLOWLIST,
  TRUSTED_RENDERER_PERMISSIONS,
  applyPermissionPolicy,
  applyWebContentsHardening,
  decidePermission,
  isHttpOrHttps,
  safeOrigin,
  trustedOriginsFromEnv,
  verifyWebviewAttach,
};
