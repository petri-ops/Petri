// ============================================================
// Brand identity — single source of truth (BLOCK-61)
//
// 这是全仓库品牌命名的唯一权威。改名 = 只改这里 +
// frontend/src/lib/brand.ts（渲染进程镜像，由
// test/brand-identity.test.mjs 契约锁一致），再跑一次机械同步。
// 业务代码禁止裸写品牌字面量——一律 import 本模块。
//
// BLOCK-165：Gewu/BioF3 → Petri 开源改名。协议面（core/petri-server
// 路径、.petri-* 用户数据目录、PETRI_* 环境变量前缀）随改名机械同步；
// 历史名链 BioF3 → Gewu → Petri 由 LEGACY_* 常量承载（旧数据目录探测）。
// ============================================================

'use strict';

const BRAND = Object.freeze({
  /** 用户可见英文品牌（窗口标题 / wordmark / 文案）。 */
  APP_NAME: "Petri",
  /** 中文名。 */
  APP_NAME_ZH: "格物",
  /** 上一代历史名——仅用于兼容识别（如旧数据目录探测），不用于展示。 */
  LEGACY_APP_NAME: "Gewu",
  /** 用户 Documents 下的工作目录名（新装环境）。 */
  LOCAL_DIR_NAME: "Petri-Local",
  /** 上一代 Documents 目录名（既有环境数据连续性优先）。 */
  LEGACY_LOCAL_DIR_NAME: "Gewu-Local",
});

/**
 * 窗口标题构建器。后缀可选（如 `Petri — 结果`）。
 */
function windowTitle(suffix) {
  return suffix ? `${BRAND.APP_NAME} — ${suffix}` : BRAND.APP_NAME;
}

/**
 * 解析用户 Documents 下的本地工作目录：既有环境保持旧目录
 * （数据连续性——R 运行时/日志都在里面），新装环境用新名。
 *
 * @param {import('electron').app} app - Electron app（取 documents 路径 + fs 探测）
 * @param {object} [fs] - 可注入 fs（测试用），默认 require('fs')
 * @returns {string} 目录名（非完整路径）
 */
function resolveLocalDirName(app, fs) {
  const fsMod = fs || require("fs");
  try {
    const legacy = require("path").join(app.getPath("documents"), BRAND.LEGACY_LOCAL_DIR_NAME);
    if (fsMod.existsSync(legacy)) return BRAND.LEGACY_LOCAL_DIR_NAME;
  } catch {}
  return BRAND.LOCAL_DIR_NAME;
}

module.exports = { BRAND, windowTitle, resolveLocalDirName };
