'use strict';

/**
 * routes/result-studio/changesets.js — 子域 stub（PHASE 2.1a）
 *
 * PHASE 2.1b 才会下沉 `changesets` / `compare` / `adopt` / `revert` 端点。
 *
 * 真实端点（PHASE 2.1b 接管）：
 *   GET  /api/result-studio/changesets
 *   GET  /api/result-studio/changesets/:changeSetId/compare
 *   POST /api/result-studio/changesets/:changeSetId/adopt
 *   POST /api/result-studio/changesets/:changeSetId/revert
 */

module.exports = {
  register(app /* , options */) {
    if (typeof app !== 'object' || typeof app.get !== 'function') {
      throw new Error('result-studio/changesets stub requires an Express app');
    }
  },
};
