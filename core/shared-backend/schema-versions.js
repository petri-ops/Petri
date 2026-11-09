'use strict';

/**
 * core/shared-backend/schema-versions.js — 跨模块 schema / 契约版本的**单一登记处**
 * （POST-S7 H4/B-17）。
 *
 * 背景：同一批「结构版本号」曾在六处各写一份字面量——
 *   `core/petri-server/helpers/artifact-truth.js`      ARTIFACT_TRUTH_VERSION = 1
 *   `core/shared-backend/result-studio-contracts.js`   RESULT_STUDIO_CONTRACT_VERSION = 1
 *   `core/shared-backend/delivery-manifest.js`         DELIVERY_MANIFEST_VERSION = 1
 *   `core/petri-server/agent-tools/registry.js`        CONTRACT_VERSION = '1.0.0'
 *   `core/petri-server/agent-tools/tool-execution.js`  TOOL_RESULT_CONTRACT_VERSION = '1.0.0'
 *   `core/petri-server/agent-tools/plugin-loader.js`   CONTRACT_VERSION = '1.0.0'
 * 六份独立字面量的真实代价不是「难看」，而是**单边升版**：改一处、漏五处时，产物写得进去
 * 但读方按旧形状解析，且没有任何机械断言会红。集中到本文件后，升版是一次编辑 + 一次契约测试。
 *
 * 纪律：
 *  - 只登记「跨模块共享的结构版本」。**同域内自洽的版本不并**——例如 Result Studio 的
 *    intent 域 `RESULT_EDIT_INTENT_VERSION` 是 String 且随回放协议独立演进（BLOCK-379 澄清），
 *    它**不**属于这里。
 *  - 升版必须同批：改本文件 → 跑 `test/block389-version-single-source.test.mjs` → 有迁移/兼容
 *    影响的补负测。禁止在调用点再写字面量（契约测试会扫）。
 */

/** 产物真值投影结构版本（artifactTruth 对象形状）。 */
const ARTIFACT_TRUTH_VERSION = 1;

/** Result Studio 契约结构版本（artifact/revision 行形状，number 形态）。 */
const RESULT_STUDIO_CONTRACT_VERSION = 1;

/** 交付清单结构版本（delivery-manifest.json 形状）。 */
const DELIVERY_MANIFEST_VERSION = 1;

/** Agent 工具调用/结果契约版本（字符串形态，面向插件作者）。 */
const TOOL_CONTRACT_VERSION = '1.0.0';

module.exports = {
  ARTIFACT_TRUTH_VERSION,
  RESULT_STUDIO_CONTRACT_VERSION,
  DELIVERY_MANIFEST_VERSION,
  TOOL_CONTRACT_VERSION,
};
