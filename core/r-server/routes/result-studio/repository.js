'use strict';

/**
 * routes/result-studio/repository.js — 子域 stub（PHASE 2.1a）
 *
 * PHASE 2.1b 才会下沉 `repository-binding` / `repository-binding/consent` 端点；
 * 本 commit 仅占位 + 暴露 helper，供主文件 facade 引用。
 *
 * 真实端点（PHASE 2.1b 接管）：
 *   GET  /api/result-studio/repository-binding
 *   POST /api/result-studio/repository-binding/consent
 */

module.exports = {
  // 占位：handler 仍在主文件 routes/result-studio.js 中
  register(app /* , options */) {
    if (typeof app !== 'object' || typeof app.get !== 'function') {
      throw new Error('result-studio/repository stub requires an Express app');
    }
  },
};
