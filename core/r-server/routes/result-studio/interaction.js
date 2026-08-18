'use strict';

/**
 * routes/result-studio/interaction.js — 子域 stub（PHASE 2.1a）
 *
 * PHASE 2.1b 才会下沉 `interaction` / `table/query` 端点。
 *
 * 真实端点（PHASE 2.1b 接管）：
 *   GET  /api/result-studio/interaction
 *   POST /api/result-studio/table/query
 */

module.exports = {
  register(app /* , options */) {
    if (typeof app !== 'object' || typeof app.get !== 'function') {
      throw new Error('result-studio/interaction stub requires an Express app');
    }
  },
};
