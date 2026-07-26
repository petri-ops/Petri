/**
 * G0-RS-P4R-0 — the four invariants, written before the code that satisfies them.
 *
 * The plan requires these as FAILING tests first, so P4R-1..P4R-5 have a
 * machine-verifiable definition of done instead of a subjective one. Several
 * assertions here are expected to fail today; that is the deliverable.
 *
 * Each invariant is written against what the code ACTUALLY does. The plan states
 * them broadly — "the body must not wait on secondary requests" — but a test
 * written from the prose is either vacuous or red for the wrong reason.
 *
 * The first revision of this file demonstrated that twice, and both are fixed
 * here: invariant 2a counted rows to detect a pointer change (is_current is a
 * COLUMN, so re-pointing leaves the count identical — the same defect its
 * sibling 2b had already been corrected for), and invariant 3 asserted a
 * non-404 for a revision id that by construction does not exist, which a
 * correctly built route would also fail.
 */

import { strict as assert } from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  createCaptureEnv,
  startServer,
  stopServer,
} from '../scripts/g0-rs-p4r-capture.mjs';
import { generateCorpus } from '../scripts/g0-rs-p4r-corpus.mjs';

const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BODY_STATE_MODULE = 'frontend/src/components/result-studio/resultBodyState.ts';
const BODY_STATE_SPEC = 'frontend/src/components/result-studio/resultBodyState.test.ts';

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

function openDisposableDb(dbPath) {
  const Database = require(require.resolve('better-sqlite3', {
    paths: [path.join(REPO_ROOT, 'core', 'r-server'), REPO_ROOT],
  }));
  return new Database(dbPath, { readonly: true });
}

function query(dbPath, sql, ...params) {
  const db = openDisposableDb(dbPath);
  try {
    return db.prepare(sql).all(...params);
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Snapshot the CURRENT pointer itself, not how many rows exist.
 *
 * is_current is a column with a unique per-family index
 * (src/migrations/001_result_studio.sql:75,:90), so a read that re-points it
 * from one revision to another leaves any count identical. Counting rows here
 * was the original defect.
 */
function currentPointers(dbPath) {
  return query(
    dbPath,
    'select artifact_family_id, revision_id from artifact_revisions where is_current = 1 order by artifact_family_id',
  );
}

/**
 * Fingerprint the binding row's mutable state.
 *
 * Row COUNT cannot see this write either: saveRepositoryBinding upserts on
 * project_id (PRIMARY KEY) and stamps updated_at
 * (result-studio-repository.js:206-208).
 */
function bindingWriteFingerprint(dbPath, projectId) {
  const rows = query(
    dbPath,
    'select project_id, status, updated_at from git_repository_bindings where project_id = ?',
    projectId,
  );
  return rows && rows.length ? rows[0] : null;
}

describe('G0-RS-P4R-0 invariants', { skip: R_BLOCKER ?? false, timeout: 900000 }, () => {
  let ctx = null;

  before(async () => {
    const corpus = await generateCorpus({ keep: true, quiet: true });
    if (!corpus.ok) throw new Error(`corpus failed: ${JSON.stringify(corpus.records)}`);
    const { env } = createCaptureEnv({ port: 0, root: corpus.root });
    const { createServer } = await import('node:net');
    const port = await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.on('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const { port: p } = probe.address();
        probe.close(() => resolve(p));
      });
    });
    env.R_SERVER_PORT = String(port);
    const server = await startServer(env);
    const deseq2 = corpus.records.find((r) => r.id === 'deseq2');
    ctx = {
      root: corpus.root,
      env,
      server,
      baseUrl: server.baseUrl,
      jobId: deseq2.toolJobId,
      projectId: corpus.projectId,
      artifact: 'volcano.png',
    };
    // Register the baseline revision so the read-path tests below have a real
    // revision to address rather than a fabricated id.
    await fetch(`${ctx.baseUrl}/api/result-studio/interaction?jobId=${ctx.jobId}&artifact=${ctx.artifact}`);
    const revisions = query(env.BIOF3_DB_PATH, 'select revision_id, is_current from artifact_revisions');
    ctx.revisionId = revisions && revisions.length ? revisions[0].revision_id : null;
  });

  after(async () => {
    await stopServer(ctx?.server?.child);
    if (ctx?.root && existsSync(ctx.root)) rmSync(ctx.root, { recursive: true, force: true });
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────
  // The plan states a CLIENT-side ordering property. This asserts the
  // server-side precondition for it and nothing more, and is named accordingly:
  // an earlier version claimed the full invariant while only checking that
  // bytes were retrievable, which would still pass if the frontend gated the
  // image on the interaction response. The client half is invariant 4.
  test('1: (server precondition) artifact bytes do not depend on any result-studio route', async () => {
    const response = await fetch(`${ctx.baseUrl}/api/tools/file/${ctx.jobId}/${ctx.artifact}`);
    assert.equal(response.status, 200, 'artifact bytes must not require a prior result-studio call');
    const bytes = (await response.arrayBuffer()).byteLength;
    assert.ok(bytes > 10000, `served ${bytes} bytes; too small to be the real render`);

    // Prove the independence rather than implying it: the byte route must not
    // be reachable only after the result-studio surface has been touched.
    const routes = readFileSync(path.join(REPO_ROOT, 'core/r-server/routes/tools-platform.js'), 'utf8');
    assert.ok(
      !/result-studio/.test(routes),
      'the artifact byte route file must not reference the result-studio surface',
    );
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────
  test('2a: reading a historical revision does not move the current pointer', async () => {
    const before = currentPointers(ctx.env.BIOF3_DB_PATH);
    assert.ok(before && before.length > 0, 'a current revision must exist to make this meaningful');

    // Address a specific revision — the original version only ever requested
    // the current artifact, so it never exercised the scenario it names.
    const reads = [
      `/api/result-studio/interaction?jobId=${ctx.jobId}&artifact=${ctx.artifact}`,
      `/api/result-studio/changesets?projectId=${ctx.projectId}`,
      `/api/result-studio/workspace/status?projectId=${ctx.projectId}`,
      `/api/result-studio/revisions/${ctx.revisionId}/artifact`,
      `/api/result-studio/revisions/${ctx.revisionId}/table-page?projectId=${ctx.projectId}`,
    ];
    for (let pass = 0; pass < 2; pass += 1) {
      for (const url of reads) await fetch(`${ctx.baseUrl}${url}`);
    }

    assert.deepEqual(
      currentPointers(ctx.env.BIOF3_DB_PATH),
      before,
      'no read may re-point is_current (a row count cannot see this — the pointer is a column)',
    );
  });

  test('2b: a pure read performs no database write', async () => {
    await fetch(`${ctx.baseUrl}/api/result-studio/workspace/status?projectId=${ctx.projectId}`);
    const before = bindingWriteFingerprint(ctx.env.BIOF3_DB_PATH, ctx.projectId);
    await new Promise((resolve) => { setTimeout(resolve, 1100); });

    for (let i = 0; i < 3; i += 1) {
      await fetch(`${ctx.baseUrl}/api/result-studio/workspace/status?projectId=${ctx.projectId}`);
    }

    // EXPECTED TO FAIL until P4R-1. routes/result-studio.js:302 declares
    // `{ write = false }` and uses it only to gate binding status, then calls
    // repo().saveRepositoryBinding() unconditionally at :320-330 — so a GET
    // writes a row and re-runs an uncached bindProjectRepository (4 git forks).
    assert.deepEqual(
      bindingWriteFingerprint(ctx.env.BIOF3_DB_PATH, ctx.projectId),
      before,
      'a read-only route must not rewrite the repository binding row',
    );
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────
  // The plan's claim is "代码 hash 不符必须阻断". The original test asked for a
  // revision id that does not exist and asserted the status was not 404 — which
  // a CORRECT implementation also fails, since 404 revision_not_found is the
  // right answer to that request. It tested nothing about hash drift.
  test('3: a revision source projection exists and refuses on hash drift', async () => {
    assert.ok(ctx.revisionId, 'a real revision is required to address the projection');

    const response = await fetch(
      `${ctx.baseUrl}/api/result-studio/revisions/${ctx.revisionId}/source?projectId=${ctx.projectId}`,
    );
    // EXPECTED TO FAIL until P4R-5: no route in routes/result-studio.js projects
    // revision source, so Express answers 404 for a revision that DOES exist.
    assert.notEqual(
      response.status,
      404,
      `no revision source projection route exists yet for a real revision (${ctx.revisionId}); P4R-5 owns it`,
    );

    const payload = await response.json();
    assert.ok(
      typeof payload.sha256 === 'string' && typeof payload.relativePath === 'string',
      'the projection must report the script identity it served',
    );

    // The blocking primitives already exist (result-studio.js:106-113,
    // result-compare-service.js:287/:494); what P4R-5 must add is a surface that
    // uses them. Drift must be refused, not served with a warning.
    const drifted = await fetch(
      `${ctx.baseUrl}/api/result-studio/revisions/${ctx.revisionId}/source?projectId=${ctx.projectId}`
      + '&expectSha256=0000000000000000000000000000000000000000000000000000000000000000',
    );
    assert.ok(
      drifted.status >= 400,
      'a source hash that does not match the revision must block, not return content',
    );
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────
  // Two confirmed violations, both inside the inline ResultArtifactShell:
  // project-workspace.tsx:3602-3612 clears manifest/table/selection BEFORE the
  // request with an empty catch at :3639-3641, and :3339-3344 calls
  // setResult(null) before fetching on the DONE path — the largest body-clear
  // in the file.
  //
  // Driven through the frontend runner rather than a bare `await import` of a
  // .ts file: CI pins Node 20, which has no type-stripping loader, so a direct
  // import would fail there regardless of how correct the module is.
  test('4: body-state decisions live in a tested pure module', () => {
    const modulePath = path.join(REPO_ROOT, BODY_STATE_MODULE);
    const specPath = path.join(REPO_ROOT, BODY_STATE_SPEC);

    // EXPECTED TO FAIL until P4R-1 extracts it.
    assert.ok(
      existsSync(modulePath),
      `${BODY_STATE_MODULE} must exist — P4R-1 extracts the decision out of `
      + 'project-workspace.tsx:3339-3344, :3366-3378 and :3602-3612',
    );
    assert.ok(existsSync(specPath), `${BODY_STATE_SPEC} must exist; nothing else covers this path`);

    // vitest runs with cwd=frontend and include 'src/**', so the filter must be
    // frontend-relative. Passing the repo-relative path matches nothing — and
    // test:files exits 1 on no matches, which is why this surfaced rather than
    // passing silently.
    const specFilter = BODY_STATE_SPEC.replace(/^frontend\//, '');
    const result = spawnSync('npm', ['run', 'test:files', '--prefix', 'frontend', '--', specFilter], {
      cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    assert.equal(result.status, 0, `the body-state spec must pass:\n${(result.stdout || '').slice(-1500)}`);
  });
});

/**
 * The contract invariant 4's module must satisfy, kept next to the test that
 * demands it so P4R-1 cannot build to a guessed shape.
 *
 * - `nextResultBodyState(shown, event)` returns `shown` BY REFERENCE for every
 *   secondary-failure event. The suite asserts with strict deepEqual, so any
 *   extra own key — even an undefined one such as `refreshing` — fails. Put
 *   degradation state in a sibling reducer.
 * - `shown` carries `jobId`, without which the identity guard cannot be
 *   exercised: a late reply from an abandoned request must be ignored, while a
 *   genuine job switch must replace the body.
 * - There is no `workflow_poll_failed{staleStatus}` event. A poll failure never
 *   delivers a stale status — useHarnessWorkflowStatus.ts:52-60 sets workflow to
 *   null, and the stale 'running' arrives from the job-list fallback at
 *   project-workspace.tsx:3294-3302. Model it as the two real events, and make
 *   the rule explicit: a job-list observation may never regress a rendered body.
 */
export const RESULT_BODY_STATE_CONTRACT = Object.freeze({
  module: BODY_STATE_MODULE,
  spec: BODY_STATE_SPEC,
  export: 'nextResultBodyState(shown, event)',
  shownShape: ['kind', 'jobId', 'artifactName', 'viewer?', 'status?'],
  events: [
    'interaction_manifest_failed',
    'workflow_status_lost',
    "job_status_observed{jobId,status,source:'workflow'|'job-list'}",
    'result_fetch_started{jobId}',
  ],
  rules: [
    'a secondary failure returns `shown` unchanged, by reference',
    "a source:'job-list' observation may never regress a rendered artifact body to a spinner",
    'result_fetch_started for the SAME jobId keeps the displayed body (project-workspace.tsx:3339-3344 clears it today)',
    'a different jobId may replace the body; a late reply for an abandoned jobId may not',
  ],
});

test('the P4R-0 invariant suite is not silently skipped', () => {
  if (R_BLOCKER) {
    assert.match(R_BLOCKER, /Rscript/);
    console.error(`[p4r-invariants] invariant coverage SKIPPED: ${R_BLOCKER}`);
  } else {
    assert.equal(R_BLOCKER, null);
  }
});
