/**
 * G0-RS-P4R-0 — the four invariants, written before the code that satisfies them.
 *
 * The plan requires these as FAILING tests first, so P4R-1..P4R-5 have a
 * machine-verifiable definition of done instead of a subjective one. Several
 * assertions here are expected to fail today; that is the deliverable, not a
 * defect in the suite.
 *
 * Each invariant is written against what the code ACTUALLY does, not against
 * the plan's prose. The plan states them broadly — "the body must not wait on
 * secondary requests" — but the survey showed the broad claim is already true
 * for some bodies and false for specific ones. A test written from the prose
 * would be vacuous (trivially green) or dishonest (red for the wrong reason),
 * which is the exact class of defect this session spent its time removing.
 *
 * Expected state at the time of writing (see rs-p4r-performance.json):
 *   1  holds server-side  — locked in as regression protection
 *   2a holds              — no read changes a current pointer
 *   2b FAILS              — every result-studio GET writes a repository binding
 *   3  FAILS              — no revision source projection route exists at all
 *   4  FAILS              — no pure body-state module exists to test
 */

import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
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

/** Count rows in a table of the disposable database, or null when absent. */
function countRows(dbPath, table) {
  const db = openDisposableDb(dbPath);
  try {
    const exists = db
      .prepare("select name from sqlite_master where type='table' and name=?")
      .get(table);
    if (!exists) return null;
    return db.prepare(`select count(*) c from ${table}`).get().c;
  } finally {
    db.close();
  }
}

/**
 * Fingerprint the binding row's mutable state.
 *
 * Row COUNT cannot see this write: saveRepositoryBinding upserts on
 * project_id (PRIMARY KEY) and stamps updated_at
 * (result-studio-repository.js:206-208), so repeated writes update one row.
 * An earlier version of invariant 2b counted rows and reported "no write"
 * while the write was happening every request.
 */
function bindingWriteFingerprint(dbPath, projectId) {
  const db = openDisposableDb(dbPath);
  try {
    const exists = db
      .prepare("select name from sqlite_master where type='table' and name='git_repository_bindings'")
      .get();
    if (!exists) return null;
    return db
      .prepare('select project_id, status, updated_at from git_repository_bindings where project_id = ?')
      .get(projectId) || null;
  } finally {
    db.close();
  }
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
  });

  after(async () => {
    await stopServer(ctx?.server?.child);
    if (ctx?.root && existsSync(ctx.root)) rmSync(ctx.root, { recursive: true, force: true });
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────
  // Plan: "结果显示不得等待 interaction/context/storage".
  // Reality: server-side this already holds — artifact bytes are served by
  // /api/tools/file, which shares no dependency with the result-studio routes.
  // Asserted so a future refactor cannot quietly couple them. The client half
  // (which body waits on which request) lives in project-workspace.tsx and is
  // covered by invariant 4, not here.
  test('1: artifact bytes are served without any result-studio request first', async () => {
    const response = await fetch(`${ctx.baseUrl}/api/tools/file/${ctx.jobId}/${ctx.artifact}`);
    assert.equal(response.status, 200, 'artifact bytes must not require a prior result-studio call');
    const bytes = (await response.arrayBuffer()).byteLength;
    assert.ok(bytes > 10000, `served ${bytes} bytes; too small to be the real render`);
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────
  // Plan: "查看历史版本不得改变 current" and, in §P4R.3, the broader "查看不写入".
  // Split deliberately: the narrow pointer claim holds today, the write-freedom
  // claim does not, and collapsing them would hide which one is broken.
  test('2a: reading does not change the current revision pointer', async () => {
    const before = countRows(ctx.env.BIOF3_DB_PATH, 'artifact_revisions');
    for (const url of [
      `/api/result-studio/interaction?jobId=${ctx.jobId}&artifact=${ctx.artifact}`,
      `/api/result-studio/changesets?projectId=${ctx.projectId}`,
      `/api/result-studio/workspace/status?projectId=${ctx.projectId}`,
    ]) {
      await fetch(`${ctx.baseUrl}${url}`);
    }
    // The first interaction call legitimately registers a baseline revision.
    // What must not happen is a further revision appearing on repeated reads.
    const afterFirst = countRows(ctx.env.BIOF3_DB_PATH, 'artifact_revisions');
    for (let i = 0; i < 3; i += 1) {
      await fetch(`${ctx.baseUrl}/api/result-studio/interaction?jobId=${ctx.jobId}&artifact=${ctx.artifact}`);
    }
    const afterRepeat = countRows(ctx.env.BIOF3_DB_PATH, 'artifact_revisions');
    assert.equal(afterRepeat, afterFirst, 'repeated reads must not create revisions');
    assert.ok(afterFirst >= before, 'sanity: baseline registration may add exactly once');
  });

  test('2b: a pure read performs no database write', async () => {
    // Warm the binding first, so this measures steady-state reads rather than
    // first-touch registration.
    await fetch(`${ctx.baseUrl}/api/result-studio/workspace/status?projectId=${ctx.projectId}`);
    const before = bindingWriteFingerprint(ctx.env.BIOF3_DB_PATH, ctx.projectId);
    // updated_at is second-resolution in places, so separate the samples.
    await new Promise((resolve) => { setTimeout(resolve, 1100); });

    for (let i = 0; i < 3; i += 1) {
      await fetch(`${ctx.baseUrl}/api/result-studio/workspace/status?projectId=${ctx.projectId}`);
    }
    const after = bindingWriteFingerprint(ctx.env.BIOF3_DB_PATH, ctx.projectId);

    // EXPECTED TO FAIL until P4R-1. routes/result-studio.js:320-330 calls
    // repo().saveRepositoryBinding() from projectContext() on every request,
    // ignoring its own `write` flag, so a GET of a historical artifact writes a
    // row and re-runs an uncached bindProjectRepository (which forks git).
    assert.deepEqual(
      after,
      before,
      'a read-only route must not rewrite the repository binding row (result-studio.js:320-330 calls '
      + 'saveRepositoryBinding from projectContext on every request, ignoring its own `write` flag)',
    );
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────
  // Plan: "代码 hash 不符必须阻断".
  // Reality: there is no surface to block on — none of the 23 routes in
  // routes/result-studio.js projects revision source. The blocking primitives
  // DO exist (result-studio.js:106-113 throws revision_output_hash_drift;
  // result-compare-service.js:287/:494 refuse on sourceScriptRef mismatch), so
  // this asserts the missing endpoint rather than re-testing the primitives.
  test('3: a revision source projection exists and refuses on hash drift', async () => {
    const response = await fetch(
      `${ctx.baseUrl}/api/result-studio/revisions/rev_does_not_exist/source?projectId=${ctx.projectId}`,
    );
    // EXPECTED TO FAIL until P4R-5. A 404 here is Express reporting "no such
    // route", not the endpoint reporting "no such revision" — the two are
    // indistinguishable by status alone, so the body is checked too.
    const body = await response.text();
    assert.notEqual(
      response.status,
      404,
      'no revision source projection route exists yet (P4R-5 owns it)',
    );
    assert.ok(
      /revision|source|not_found/i.test(body),
      'the route must answer with a revision-shaped error, not an Express 404 page',
    );
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────
  // Plan: "次级请求失败不得清空主体".
  // Reality: two confirmed violations, both in the inline ResultArtifactShell —
  // project-workspace.tsx:3602-3612 clears interactionManifest/backingTable/
  // selection BEFORE the request with an empty catch at :3639-3641, and
  // :3366-3378 calls setResult(null) when a harness poll failure lets a stale
  // 'running' status win.
  //
  // Neither is testable where it lives: the component is defined inline inside a
  // 4935-line file and owns ~30 hooks. Asserting on the file's source text would
  // be the string-matching antipattern this session removed elsewhere. So the
  // test imports the pure decision module that P4R-1 must extract, and fails on
  // its absence — which is a real failing test, not a placeholder.
  test('4: body-state decisions live in a pure module that never clears on secondary failure', async () => {
    let mod = null;
    try {
      mod = await import('../frontend/src/components/result-studio/resultBodyState.ts');
    } catch {
      mod = null;
    }
    // EXPECTED TO FAIL until P4R-1 extracts it.
    assert.ok(
      mod && typeof mod.nextResultBodyState === 'function',
      'frontend/src/components/result-studio/resultBodyState.ts must export nextResultBodyState '
      + '(P4R-1 extracts the decision out of project-workspace.tsx:3366-3378 and :3602-3612)',
    );

    const shown = { kind: 'artifact', artifactName: 'volcano.png' };
    // A secondary failure must degrade the secondary feature, never the body.
    assert.deepEqual(
      mod.nextResultBodyState(shown, { type: 'interaction_manifest_failed' }),
      shown,
      'an interaction-manifest failure must leave the displayed body intact',
    );
    assert.deepEqual(
      mod.nextResultBodyState(shown, { type: 'workflow_poll_failed', staleStatus: 'running' }),
      shown,
      'a stale poll status must not replace a displayed result with a spinner',
    );
  });
});

test('the P4R-0 invariant suite is not silently skipped', () => {
  if (R_BLOCKER) {
    assert.match(R_BLOCKER, /Rscript/);
    console.error(`[p4r-invariants] invariant coverage SKIPPED: ${R_BLOCKER}`);
  } else {
    assert.equal(R_BLOCKER, null);
  }
});
