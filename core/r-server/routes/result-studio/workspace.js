'use strict';

/**
 * routes/result-studio/workspace.js — 子域 stub（PHASE 2.1a）
 *
 * PHASE 2.1b 才会下沉 `workspace/status` / `workspace/recover` 端点。
 *
 * 真实端点（PHASE 2.1b 接管）：
 *   GET  /api/result-studio/workspace/status
 *   POST /api/result-studio/workspace/recover
 */

module.exports = {
  register(app /* , options */) {
    if (typeof app !== 'object' || typeof app.get !== 'function') {
      throw new Error('result-studio/workspace stub requires an Express app');
    }
  },
};
