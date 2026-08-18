'use strict';

/**
 * routes/result-studio/revisions.js — 子域 stub（PHASE 2.1a）
 *
 * PHASE 2.1b 才会下沉 `revisions` / `source` / `replay` / `restore` / `artifact` / `table-page` 端点。
 *
 * 真实端点（PHASE 2.1b 接管）：
 *   GET  /api/result-studio/revisions/:revisionId/source
 *   POST /api/result-studio/revisions/:revisionId/replay
 *   POST /api/result-studio/revisions/:revisionId/restore
 *   GET  /api/result-studio/revisions/:revisionId/artifact
 *   GET  /api/result-studio/revisions/:revisionId/table-page
 */

module.exports = {
  register(app /* , options */) {
    if (typeof app !== 'object' || typeof app.get !== 'function') {
      throw new Error('result-studio/revisions stub requires an Express app');
    }
  },
};
