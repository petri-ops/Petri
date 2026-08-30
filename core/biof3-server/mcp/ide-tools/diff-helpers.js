/**
 * core/biof3-server/mcp/ide-tools/diff-helpers.js
 *
 * Re-export + re-implementation of the unified-diff parser / summarizer
 * from ./diff.js so that other Phase 3 git tools (git-diff / git-show) can
 * share the same parsing pipeline without copying the full implementation.
 *
 * diff.js keeps its existing _parseUnifiedHunks accessor exposed; this
 * module re-exports it under a stable, public-facing name. The 5-line
 * `summarize` helper is duplicated here to avoid touching diff.js's
 * module.exports (which Phase 1.5 already froze).
 */

'use strict';

const diff = require('./diff');

const parseUnifiedHunks = diff._parseUnifiedHunks;

/**
 * Count +/- lines across hunks. Same semantics as diff.js#summarize.
 */
function summarize(hunks) {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    for (const l of h.lines) {
      if (l.startsWith('+') && !l.startsWith('+++')) added++;
      else if (l.startsWith('-') && !l.startsWith('---')) removed++;
    }
  }
  return { added, removed };
}

module.exports = {
  parseUnifiedHunks,
  summarize,
};
