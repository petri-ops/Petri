'use strict';

/**
 * routes/result-studio/storage.js — 子域 stub（PHASE 2.1a）
 *
 * PHASE 2.1b 才会下沉 `storage/gc` / `storage/deduplicate` 端点。
 *
 * 真实端点（PHASE 2.1b 接管）：
 *   GET  /api/result-studio/storage/gc
 *   GET  /api/result-studio/storage/deduplicate
 *   POST /api/result-studio/storage/deduplicate
 *   POST /api/result-studio/storage/gc
 */

module.exports = {
  register(app /* , options */) {
    if (typeof app !== 'object' || typeof app.get !== 'function') {
      throw new Error('result-studio/storage stub requires an Express app');
    }
  },
};
