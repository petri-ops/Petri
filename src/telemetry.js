/**
 * telemetry.js — M2-3 可选错误遥测（V3）
 *
 * 设计原则（隐私优先）：
 * 1. 默认关闭——只有用户在设置页主动开启"错误反馈"后才会发送。
 * 2. 最小 payload——仅含 category / appVersion / errorSummary / timestamp，
 *    绝不含用户数据、文件路径、文件名、API key 或对话内容。
 * 3. 失败静默——网络异常或端点不可达时直接吞掉，不影响任何业务流程。
 * 4. 可随时关——每次上报前都重新读设置，关掉后立即停止发送。
 *
 * 主进程模块，被 main.js 的 IPC handler 调用。
 */

const { app } = require('electron');
const path = require('path');

// 占位端点——上线前替换为真实接收服务。HTTPS 保证传输加密。
const TELEMETRY_ENDPOINT = 'https://biof3.com/api/telemetry';

// errorSummary 最大长度，防止意外把长堆栈/路径泄出去。
const MAX_SUMMARY_LEN = 200;

// 与 main.js resolveResource 一致的资源解析（不依赖 main 内部函数）
// 开发模式：仓库根（desktop-app/../ ）
// 打包模式：process.resourcesPath
const _PROJECT_ROOT = path.join(__dirname, '..', '..');
const _IS_DEV = !app.isPackaged;
function _resolveResource(...parts) {
  if (_IS_DEV) return path.join(_PROJECT_ROOT, ...parts);
  return path.join(process.resourcesPath, ...parts);
}

/**
 * 读取遥测开关。复用 ai-settings.json 存储（同一文件，字段 telemetry_enabled）。
 * 默认 false——硬要求。
 * @returns {boolean}
 */
function isTelemetryEnabled() {
  try {
    const { getAiSettings } = require(_resolveResource('biof3-server', 'helpers', 'ai-settings.js'));
    const s = getAiSettings();
    return !!(s && s.telemetry_enabled === true);
  } catch {
    // 读设置失败时按"关闭"处理，绝不误发。
    return false;
  }
}

/**
 * 上报错误。最小化 payload，仅含分类 + 版本 + 错误摘要 + 时间戳。
 *
 * @param {{category?: string, errorSummary?: string}} payload - 渲染进程传入的极简信息
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function reportError(payload) {
  // 1. 开关检查——默认关闭，关则直接 return
  if (!isTelemetryEnabled()) {
    return { ok: false, reason: 'disabled' };
  }

  // 2. 构造最小 payload，白名单字段，拒绝任何用户数据/路径
  const category = _sanitize(String((payload && payload.category) || 'unknown'), 50);
  const errorSummary = _sanitize(String((payload && payload.errorSummary) || ''), MAX_SUMMARY_LEN);
  const body = {
    category,
    appVersion: _getAppVersion(),
    errorSummary,
    timestamp: new Date().toISOString(),
  };

  // 3. 上报，失败静默
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000); // 5s 超时，不阻塞
    const res = await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      return { ok: false, reason: 'http_' + res.status };
    }
    return { ok: true };
  } catch {
    // 网络异常/超时/端点不可达——静默
    return { ok: false, reason: 'network' };
  }
}

/**
 * 获取应用版本。优先 app.getVersion()，回退 package.json。
 */
function _getAppVersion() {
  try {
    if (app && typeof app.getVersion === 'function') {
      return app.getVersion();
    }
  } catch {}
  try {
    const pkg = require(path.join(__dirname, '..', 'package.json'));
    return (pkg && pkg.version) || 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * 清洗字符串：截断 + 去掉潜在路径/换行。
 * 即便上游误传了带路径的错误信息，也只保留前 N 字符的摘要。
 */
function _sanitize(str, maxLen) {
  if (!str) return '';
  let s = String(str)
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

module.exports = {
  reportError,
  isTelemetryEnabled,
  TELEMETRY_ENDPOINT,
};
