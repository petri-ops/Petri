/**
 * G0-RS-P4R-0 open-result baseline capture.
 *
 * The assertions that matter here are the ones about whether the measurement is
 * REAL. The first working version of this capture reported a complete-looking
 * waterfall in which four of six requests had returned 400/404 — it had timed
 * argument validation, including a 0.9ms reading for the route the survey
 * identified as the most expensive in the system. A baseline that measures
 * rejection is worse than no baseline, because it looks like evidence.
 *
 * So: a request that must succeed is asserted to have succeeded, and any route
 * that could not be measured is recorded as unmeasured rather than folded into
 * the numbers.
 */

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { fingerprintRealDataRoot } from '../scripts/g0-rs-p4r-capture.mjs';
import { captureBaseline } from '../scripts/g0-rs-p4r-baseline.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DB = path.join(REPO_ROOT, 'core', 'biof3-server', 'biof3.db');
const REAL_DATA_ROOT = path.join(homedir(), 'Documents', 'BioF3-Local');

/** Routes whose cost is the whole point of the baseline. */
const MUST_BE_MEASURED = ['job-status', 'artifact-bytes', 'interaction', 'changesets', 'workspace-status'];

function rRuntimeBlocker() {
  try {
    execFileSync('Rscript', ['-e', 'if(!requireNamespace("DESeq2",quietly=TRUE)) quit(status=1)'], {
      stdio: 'ignore',
      timeout: 60000,
    });
    return null;
  } catch {
    return 'requires Rscript with DESeq2 installed';
  }
}

const R_BLOCKER = rRuntimeBlocker();

test(
  'the baseline measures the real path, not argument validation',
  { timeout: 900000, skip: R_BLOCKER ?? false },
  async () => {
    const devDbBefore = existsSync(REPO_DB) ? statSync(REPO_DB).mtimeMs : null;
    const realRootBefore = fingerprintRealDataRoot(REAL_DATA_ROOT);

    const result = await captureBaseline({ quiet: true });

    const byId = new Map(result.requests.map((request) => [request.id, request]));
    for (const id of MUST_BE_MEASURED) {
      const request = byId.get(id);
      assert.ok(request, `${id} was not driven at all`);
      assert.equal(
        request.status,
        200,
        `${id} returned ${request.status}; a non-200 means the baseline timed a rejection, not the real path`,
      );
      assert.ok(request.totalMs > 0, `${id} has no timing`);
      assert.equal(request.error, null, `${id} errored: ${request.error}`);
    }

    // The corpus must be real: real tool jobs, real artifact bytes served.
    assert.ok(result.corpus.length >= 3, 'corpus must cover the chained tools');
    for (const record of result.corpus) assert.match(record.toolJobId || '', /^tj_/);
    assert.ok(byId.get('artifact-bytes').bytes > 10000, 'artifact bytes look too small to be a real render');

    // The event-loop histogram is the authoritative signal for the plan's
    // >250ms gate; it must carry real samples, not the empty-histogram sentinel.
    assert.ok(result.eventLoop, 'event loop must be sampled');
    assert.ok(result.eventLoop.samples > 0, 'event loop histogram recorded nothing');
    assert.ok(Number.isFinite(result.eventLoop.maxMs), 'event loop max must be a real sample');

    // Client metrics must stay explicitly unmeasured rather than estimated.
    for (const [key, metric] of Object.entries(result.clientMetrics)) {
      assert.equal(metric.observedMs, null, `${key} must not be fabricated`);
      assert.match(metric.status, /not_captured/, `${key} must state why it is absent`);
    }

    assert.equal(existsSync(result.root), false, 'the baseline must remove its root');
    assert.equal(
      existsSync(REPO_DB) ? statSync(REPO_DB).mtimeMs : null,
      devDbBefore,
      'the developer database must be untouched',
    );
    assert.deepEqual(
      fingerprintRealDataRoot(REAL_DATA_ROOT),
      realRootBefore,
      'the real user data root must be untouched',
    );
  },
);

test('the R-backed baseline test is not silently skipped', () => {
  if (R_BLOCKER) {
    assert.match(R_BLOCKER, /Rscript/);
    console.error(`[p4r-baseline] real-path coverage SKIPPED: ${R_BLOCKER}`);
  } else {
    assert.equal(R_BLOCKER, null);
  }
});
