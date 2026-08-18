'use strict';

/**
 * routes/result-studio/selection.js — 子域 stub（PHASE 2.1a）
 *
 * PHASE 2.1b 才会下沉 `selection` 系列端点。
 *
 * 真实端点（PHASE 2.1b 接管）：
 *   POST /api/result-studio/selection
 *   GET  /api/result-studio/selection/current
 *   GET  /api/result-studio/selection/:selectionId
 *   DELETE /api/result-studio/selection/:selectionId
 *   POST /api/result-studio/selection/query
 *   POST /api/result-studio/selection/resolve
 */

module.exports = {
  register(app /* , options */) {
    if (typeof app !== 'object' || typeof app.get !== 'function') {
      throw new Error('result-studio/selection stub requires an Express app');
    }
  },
};
