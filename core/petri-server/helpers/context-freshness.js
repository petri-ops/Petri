'use strict';

/**
 * helpers/context-freshness.js — BLOCK-56 P3 上下文保鲜（纯函数）。
 *
 * 语义（plan §2.3）：agent loop 维护内存 map `path → {hash, readAt, iteration}`；
 * workspace_read 命中已读文件时：
 *   - hash 相同 → 结果附 `unchanged: true`（提示模型磁盘内容与上次一致，免重述）
 *   - hash 变化 → 结果附 `changedSinceLastRead: true`（模型自判是否重读）
 *   - 首次读取（新文件）→ 只附 `fingerprint`，不加标记
 * 不做：自动重读 / 自动失效旧内容（模型裁决权保留，对齐「不硬冲」纪律）。
 *
 * 成本边界：readFile 仅对 ≤MAX_TEXT_FILE_BYTES 的文本文件返回 sha256，
 * 二进制/超大文件走既有错误路径 —— 指纹只做 sha256 前 8 位切片，零额外哈希成本。
 */

const FINGERPRINT_LENGTH = 8;

/** 从完整 sha256 取短指纹（前 8 位小写 hex）。 */
function fingerprintOf(sha256) {
  const hash = String(sha256 || '');
  return hash ? hash.slice(0, FINGERPRINT_LENGTH) : null;
}

/**
 * 创建一次 agent loop 生命周期内的保鲜追踪器（内存态，不落库）。
 * @returns {{observe: function, size: function}}
 */
function createFreshnessTracker() {
  const byPath = new Map();
  return {
    /**
     * 记录一次 workspace_read 并给出相对上次读取的标记。
     * @param {string} relativePath 工具结果里的 path（项目相对路径）
     * @param {string} sha256 工具结果里的完整 sha256
     * @param {number} [iteration] 当前 loop 迭代号（1 起）
     * @returns {{fingerprint: string, unchanged?: boolean, changedSinceLastRead?: boolean}}
     */
    observe(relativePath, sha256, iteration) {
      const key = String(relativePath || '');
      const hash = String(sha256 || '');
      const fingerprint = fingerprintOf(hash);
      if (!key || !fingerprint) {
        // 无法追踪（缺 path/hash）→ 不加任何标记，避免模型误读
        return {};
      }
      const previous = byPath.get(key);
      byPath.set(key, { hash, readAt: Date.now(), iteration: Number.isFinite(iteration) ? iteration : null });
      if (!previous) return { fingerprint };
      if (previous.hash === hash) return { fingerprint, unchanged: true };
      return { fingerprint, changedSinceLastRead: true };
    },
    /** 测试/诊断用：当前追踪的文件数。 */
    size() {
      return byPath.size;
    },
  };
}

/**
 * 把保鲜标记合入 workspace_read 工具结果（就地增强，供事件与模型消息共用）。
 * 结果不 ok / 缺 sha256 / 缺 path 时原样返回（零副作用）。
 * @param {object} result localizeToolResult 后的工具结果
 * @param {{observe: function}} tracker createFreshnessTracker 实例
 * @param {number} [iteration]
 * @returns {object} 增强后的 result（同一引用或原引用）
 */
function applyFreshnessMark(result, tracker, iteration) {
  if (!result || result.ok !== true || !result.sha256 || !result.path) return result;
  const marks = tracker.observe(result.path, result.sha256, iteration);
  return { ...result, ...marks };
}

module.exports = { createFreshnessTracker, applyFreshnessMark, fingerprintOf };
