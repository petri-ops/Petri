/**
 * Petri shared backend — Path Safety Helpers
 *
 * Path-traversal guards for joining user-supplied segments under a base
 * directory. Extracted from petri-server/helpers/tools-assets.js so platform,
 * petri-server can share the same guard without importing from
 * petri-server by name.
 */

const path = require('path');

/**
 * Join user-supplied segments under baseDir and verify the resolved path
 * stays inside baseDir. Returns null if it escapes (e.g. '../').
 * Callers must treat null as 400 bad_path.
 */
function safeJoinUnder(baseDir, ...segments) {
  const base = path.resolve(baseDir);
  const target = path.resolve(base, ...segments);
  if (target !== base && !target.startsWith(base + path.sep)) return null;
  return target;
}

module.exports = {
  safeJoinUnder,
};
