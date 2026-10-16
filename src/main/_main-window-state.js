// ============================================================
// BLOCK-185 — 主窗最后路由持久化（冷启动深链恢复的 Electron 重启面）
//
// 根因：_window-create.js 恒 loadURL(spaServerUrl 根)，全仓无 last-url 持久化
// → Electron 重启本就落 `/`，用户离开的深链（/project/:id?job=…）丢失。
//
// 设计取舍：只持久化 **SPA 相对路由**（path+search+hash），不存完整 URL。
//   ① 安全：恢复时永远拼当前 SPA origin，杜绝开放重定向/外部 URL；
//   ② 端口漂移免疫：dev 栈重启端口变化不影响（存的是 path 不含 host:port）；
//   ③ 非「第二路由真相」：这是启动恢复提示，前端路由真值仍在 URL/store，不新建平行路由态。
//
// 纯函数（extractRestorableRoute / buildRestoreUrl）无 Electron/fs 依赖，可单测；
// fs 薄壳（loadLastRoute / saveLastRoute）显式收 statePath，便于注入与测试。
// ============================================================
const fs = require("fs");

/**
 * 从「当前加载的绝对 URL」抽出可恢复的相对路由。仅当该 URL 与 SPA base 同源
 * 且为本地路由时返回，否则返回 null（外部页/异常态一律不持久化）。
 * @param {string} absoluteUrl  webContents.getURL() 结果
 * @param {string} baseUrl      spaServerUrl（SPA origin 根）
 * @returns {string|null} 形如 "/project/p1?job=j2#h" 的相对路由，或 null
 */
function extractRestorableRoute(absoluteUrl, baseUrl) {
  if (typeof absoluteUrl !== "string" || typeof baseUrl !== "string") return null;
  let abs, base;
  try {
    abs = new URL(absoluteUrl);
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  // 同源门：协议 + host + port 必须一致，杜绝跨源/外部 URL 被当作本地路由存下
  if (abs.protocol !== base.protocol || abs.host !== base.host) return null;
  const route = `${abs.pathname}${abs.search}${abs.hash}`;
  if (!route || route === "/" || route === "") return null; // 根路由无需恢复
  return route;
}

/**
 * 用当前 SPA base 拼接已存路由，得到启动时应加载的绝对 URL。
 * 校验失败（非法/协议相对/含 scheme）返回 null → 调用方回落根 URL。
 * @param {string} baseUrl
 * @param {string} route  loadLastRoute 读回的相对路由
 * @returns {string|null}
 */
function buildRestoreUrl(baseUrl, route) {
  if (typeof route !== "string" || typeof baseUrl !== "string") return null;
  // 白名单：必须以单个 "/" 开头；禁 "//"（协议相对→开放重定向）与含 scheme 的绝对 URL
  if (route[0] !== "/" || route.startsWith("//")) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(route)) return null;
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  const origin = base.origin;
  if (origin === "null") return null;
  return `${origin}${route}`;
}

function loadLastRoute(statePath) {
  try {
    const raw = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return typeof raw?.route === "string" ? raw.route : null;
  } catch {
    return null;
  }
}

function saveLastRoute(statePath, route) {
  try {
    fs.mkdirSync(require("path").dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ route }));
    return true;
  } catch {
    return false;
  }
}

module.exports = { extractRestorableRoute, buildRestoreUrl, loadLastRoute, saveLastRoute };
