'use strict';

/**
 * BLOCK-360（NSO-W2-1）全局 IPC sender 信任门。
 *
 * 为什么是全局补丁而不是逐模块 guard：现存 ~150 处 ipcMain.handle/on 中只有 5 个模块调用
 * createSenderGuard，其余（含 workspace:write-text-file 这类写面）裸奔；逐模块接入既漏且
 * 新增入口会再漏。这里在 main.js 最早处给 ipcMain.handle / ipcMain.on 打一次补丁，此后任何
 * 注册自动先过信任判定——「任何新入口都必须接同一拦截器」由结构保证而不是靠纪律。
 * 模块内既有的 createSenderGuard（主窗精确比对）保持不动，与本门叠加不冲突。
 *
 * 信任谓词（纯函数，单测逐条钉死）：
 *   - sender 缺失/已销毁 → ipc_sender_missing
 *   - sender 类型为 webview（结果浏览器面板的远程 guest）→ ipc_sender_webview，与 URL 无关
 *   - 判定 URL = senderFrame.url 优先（受信页内远程子帧不得借道），否则 sender.getURL()
 *   - file: 协议 → 仅登记过的应用内资源窗放行（S2/G-07 注册制；未登记拒绝）
 *   - 其余按 origin 精确匹配 PETRI_TRUSTED_DESKTOP_ORIGINS（env-coordinator 写入：dev Vite
 *     localhost/127.0.0.1 双变体 + packaged rendererPort 双变体）；集合为空 → fail-closed
 *
 * 受信集合每次事件现读（惰性），因此本门可以在 setupDesktopEnv 之前安装。
 */

const GUARD_MARK = Symbol.for('petri.ipcSenderGuard');

// BLOCK-377（S2 / G-07）——file: sender 注册制：此前任意 file: URL 一律放行
// （「仅自家资源窗」假设可被本地构造的 file: 页面冒认）。改为显式注册制：
// 应用内加载 file: 的窗口（现仅 computer-use PiP）创建时登记 webContents id；
// 未登记的 file: sender 一律拒绝（ipc_sender_file_unregistered）。
// 豁免口=PETRI_IPC_FILE_SENDER_EXEMPT_IDS（逗号分隔 webContents id，登记制留痕）。
const registeredFileSenderHostIds = new Set();

function readExemptFileSenderIds(env = process.env) {
  return String(env.PETRI_IPC_FILE_SENDER_EXEMPT_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * 登记允许以 file: 协议发起 IPC 的 webContents（应用内资源窗）。
 * @param {number|{ id: number }} webContentsOrId
 */
function registerTrustedFileSenderHost(webContentsOrId) {
  const id = typeof webContentsOrId === 'object' && webContentsOrId ? webContentsOrId.id : webContentsOrId;
  if (Number.isFinite(Number(id))) registeredFileSenderHostIds.add(Number(id));
}

function resetRegisteredFileSenderHosts() {
  registeredFileSenderHostIds.clear();
}

function safeOrigin(url) {
  try {
    return new URL(String(url || '')).origin;
  } catch {
    return '';
  }
}

function isDestroyed(contents) {
  if (!contents) return true;
  return typeof contents.isDestroyed === 'function' ? contents.isDestroyed() : false;
}

// L1-3（蓝图 L-52）：env 源回环过滤（谓词单源经 env-coordinator re-export，守 R3）。
function readTrustedOriginsFromEnv(env = process.env) {
  const isLoopback = require('../main/env-coordinator').isLoopbackHttpOrigin;
  return String(env.PETRI_TRUSTED_DESKTOP_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value && isLoopback(value));
}

/**
 * @param {{ event: any, trustedOrigins: string[] }} input
 * @returns {{ ok: true } | { ok: false, reason: string, detail?: object }}
 */
function decideIpcSenderTrust({ event, trustedOrigins }) {
  const sender = event && event.sender;
  if (!sender || isDestroyed(sender)) return { ok: false, reason: 'ipc_sender_missing' };
  const type = typeof sender.getType === 'function' ? sender.getType() : 'window';
  if (type === 'webview') return { ok: false, reason: 'ipc_sender_webview' };
  const frameUrl = event.senderFrame && typeof event.senderFrame.url === 'string' ? event.senderFrame.url : '';
  const url = frameUrl || (typeof sender.getURL === 'function' ? sender.getURL() : '');
  if (/^file:/i.test(url)) {
    // BLOCK-377（S2 / G-07）——file: 不再默认放行：仅登记过的应用内资源窗
    // （PiP 等）或显式 env 豁免 id 可通过；未登记=拒绝。
    const senderId = Number(sender.id);
    if (registeredFileSenderHostIds.has(senderId)) return { ok: true };
    if (readExemptFileSenderIds().includes(String(senderId))) return { ok: true };
    return { ok: false, reason: 'ipc_sender_file_unregistered', detail: { senderId } };
  }
  const origin = safeOrigin(url);
  const trusted = Array.isArray(trustedOrigins) ? trustedOrigins : [];
  if (!origin || !trusted.includes(origin)) {
    return { ok: false, reason: 'ipc_sender_origin_untrusted', detail: { origin: origin || null } };
  }
  return { ok: true };
}

/**
 * 给 ipcMain.handle / ipcMain.on 打信任补丁（幂等）。
 * @param {{ handle: Function, on: Function }} ipcMain
 * @param {{ getTrustedOrigins?: () => string[], onReject?: (info: object) => void }} [options]
 */
function installGlobalIpcSenderGuard(ipcMain, { getTrustedOrigins = readTrustedOriginsFromEnv, onReject } = {}) {
  if (!ipcMain || ipcMain[GUARD_MARK]) return ipcMain;
  const reported = new Set();
  const reject = (channel, decision) => {
    const info = { channel, reason: decision.reason, ...(decision.detail || {}) };
    if (typeof onReject === 'function') {
      try { onReject(info); } catch { /* 观测回调失败不影响拒绝语义 */ }
    }
    // 同一 channel×原因只打一次日志，避免被攻击页刷屏
    const key = `${channel}|${decision.reason}`;
    if (!reported.has(key)) {
      reported.add(key);
      console.warn(`[ipc-guard] 拒绝未受信 sender：channel=${channel} reason=${decision.reason}`);
    }
  };
  const originalHandle = ipcMain.handle.bind(ipcMain);
  const originalOn = ipcMain.on.bind(ipcMain);
  ipcMain.handle = function guardedHandle(channel, handler) {
    return originalHandle(channel, async (event, ...args) => {
      const decision = decideIpcSenderTrust({ event, trustedOrigins: getTrustedOrigins() });
      if (!decision.ok) {
        reject(channel, decision);
        return { ok: false, error: 'unauthorized', reason: decision.reason };
      }
      return handler(event, ...args);
    });
  };
  ipcMain.on = function guardedOn(channel, listener) {
    return originalOn(channel, (event, ...args) => {
      const decision = decideIpcSenderTrust({ event, trustedOrigins: getTrustedOrigins() });
      if (!decision.ok) {
        reject(channel, decision);
        return undefined;
      }
      return listener(event, ...args);
    });
  };
  Object.defineProperty(ipcMain, GUARD_MARK, { value: true, enumerable: false });
  return ipcMain;
}

module.exports = {
  decideIpcSenderTrust,
  installGlobalIpcSenderGuard,
  readTrustedOriginsFromEnv,
  registerTrustedFileSenderHost,
  resetRegisteredFileSenderHosts,
};
