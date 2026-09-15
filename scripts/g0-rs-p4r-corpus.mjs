#!/usr/bin/env node
/**
 * G0-RS-P4R-0 — generate a real baseline corpus inside a disposable root.
 *
 * P4R-0 must measure the real open-result path, and the plan forbids using a
 * database seed as a stand-in for a real product journey. So the corpus is
 * produced by actually running the canonical chain:
 *
 *   run_tool -> tool_job -> artifact truth
 *
 * Isolation comes from scripts/g0-rs-p4r-capture.mjs: ISOLATED_PATH_ENV
 * redirects every writable path into a throwaway root, and assertIsolated()
 * fails closed. The developer database and ~/Documents/BioF3-Local are never
 * touched.
 *
 * WHY A CHILD PROCESS: core/biof3-server/config.js and core/biof3-server/db.js snapshot
 * the environment at module load, and mcp/registry.js computes its jobs dir at
 * load too. A caller that already required any of them would bind the run to
 * real paths no matter what we assign afterwards. Running the tools in a fresh
 * child, with the isolated environment supplied at spawn, makes the ordering
 * impossible to get wrong from the outside.
 *
 * Tool selection reflects what actually exists. `heatmap` is NOT a tool — the
 * built-ins are deg-standardizer, deseq2, expression-qc, gene-correlation,
 * go-kegg, gsea, pca-explorer, sample-metadata-validator, volcano-plot and
 * wgcna. A heatmap artifact comes from deseq2's own output or from
 * gene-correlation, which is why the default set uses the latter.
 *
 * Usage:
 *   node scripts/g0-rs-p4r-corpus.mjs                    # default set, root removed
 *   node scripts/g0-rs-p4r-corpus.mjs --keep             # keep the root
 *   node scripts/g0-rs-p4r-corpus.mjs --with-enrichment  # add GO-BP via go-kegg
 *   node scripts/g0-rs-p4r-corpus.mjs --json
 */

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { applyMigrations, createCaptureEnv, inspectTables } from './g0-rs-p4r-capture.mjs';
import { buildPackEnv, resolveBioPackRoot, resolvePackCorpusInputs } from './g0-rs-p4r-pack.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SELF = fileURLToPath(import.meta.url);

/**
 * Ordered corpus steps. Each declares how its params are built, because the
 * plugins disagree about how inputs arrive: deseq2 and go-kegg glob the job
 * directory by filename prefix, while volcano-plot and gene-correlation read an
 * absolute path out of params. Chaining is always explicit — nothing inspects a
 * previous job.
 */
export const CORPUS_STEPS = Object.freeze([
  {
    id: 'deseq2',
    toolId: 'deseq2',
    heavy: true,
    describes: 'differential expression table plus volcano/heatmap/pca renders',
    params: ({ inputs }) => ({
      counts: inputs.counts,
      coldata: inputs.coldata,
      design: 'condition',
      contrast_ref: 'Control',
      contrast_treat: 'Treatment',
      padj_cutoff: 0.05,
      lfc_cutoff: 1,
    }),
  },
  {
    id: 'volcano-plot',
    toolId: 'volcano-plot',
    dependsOn: 'deseq2',
    describes: 'standalone volcano render from the DEG table',
    // volcano-plot.R reads params$deg_table as an absolute path.
    params: ({ outputs }) => ({ deg_table: outputs.deseq2['deg_table.csv'] }),
  },
  {
    id: 'gene-correlation',
    toolId: 'gene-correlation',
    dependsOn: 'deseq2',
    describes: 'correlation heatmap — the closest real tool to the plan\'s "heatmap"',
    params: ({ outputs }) => ({
      expr_matrix: outputs.deseq2['vst_matrix.csv'],
      top_n: 30,
      method: 'pearson',
    }),
  },
  {
    id: 'go-kegg',
    toolId: 'go-kegg',
    optional: true,
    describes: 'GO-BP enrichment table and dotplot through the go-kegg plugin',
    // Uses real human gene symbols: the deseq2 demo genes are synthetic
    // (Gene1..Gene2000) and would enrich to nothing.
    params: ({ inputs }) => ({
      deg_table: inputs.enrichmentGenes,
      species: 'human',
      gene_id_type: 'SYMBOL',
      // P4R-5 needs one formal enrichment Artifact from the go-kegg plugin,
      // not a live KEGG network probe.  GO-BP is fully local once the declared
      // r-enrichment runtime is ready, while `all` also asks the plugin to run
      // KEGG and used to make this deterministic source observation depend on
      // a transient KEGG REST fallback whenever the offline snapshot was not
      // available.  Keep the product execution truth intact: this is a real
      // GO-BP Job, not a failed all-analysis Job relabelled as completed.
      analysis_type: 'GO-BP',
    }),
  },
]);

const CHILD_TIMEOUT_MS = 600000;

function selectSteps({ withEnrichment = false } = {}) {
  return CORPUS_STEPS.filter((step) => !step.optional || withEnrichment);
}

/**
 * Child entry point: the isolated environment is already in place because the
 * parent supplied it at spawn, so requiring the core modules here binds them to
 * the disposable root.
 */
async function runStepsInChild() {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const spec = JSON.parse(process.argv[process.argv.indexOf('--child') + 1]);

  const { tool_run_tool: runTool } = require(path.join(REPO_ROOT, 'core', 'biof3-server', 'agent-tools', 'learning.js'));
  const db = require(path.join(REPO_ROOT, 'core', 'biof3-server', 'db.js'));

  // Package-aware inputs: the demo CSVs live in the bio domain pack since
  // BLOCK-83. resolveBioPackRoot() honors BIOF3_BIO_PACK_ROOT, which the parent
  // may have set — the spawned env inherits it, so parent and child resolve the
  // same pack.
  const inputs = resolvePackCorpusInputs(resolveBioPackRoot());

  // A project is REQUIRED, not cosmetic. Every Result Studio route
  // (interaction, context-envelope, changesets, workspace/status) validates a
  // projectId and rejects with 400/404 without one, so a project-less corpus
  // would let a baseline capture "measure" argument validation instead of the
  // real path. The workspace path lands inside BIOF3_LOCAL_DATA_DIR, which
  // ISOLATED_PATH_ENV has already redirected into the disposable root.
  const CORPUS_USER = 'p4r-corpus';
  const project = db.createProject({
    name: 'p4r-baseline-corpus',
    description: 'G0-RS-P4R-0 disposable baseline corpus',
    modality: 'bulk',
    userId: CORPUS_USER,
  });
  // createProject accepts userId but does not persist it — its INSERT omits the
  // column (db.js:463). Ownership is a separate call, and without it
  // project-run-layout.js:97 denies every run, since the fallback admin check
  // needs a users row this disposable database does not have.
  db.setProjectUserId(project.id, CORPUS_USER);

  const steps = selectSteps({ withEnrichment: spec.withEnrichment });
  const outputs = {};
  const records = [];

  for (const step of steps) {
    const params = step.params({ repoRoot: REPO_ROOT, inputs, outputs });
    const startedAt = Date.now();
    // accessMode 'full' is required for HEAVY_TOOLS (deseq2); it is the
    // documented delegation boundary for local reproducible analysis and still
    // produces a fully audited Job/Artifact trail.
    const result = await runTool(
      { op: 'run', toolId: step.toolId, params },
      { userId: 'p4r-corpus', accessMode: 'full', allowExecution: true, projectId: project.id },
    );

    const record = {
      id: step.id,
      toolId: step.toolId,
      ok: Boolean(result?.ok),
      durationMs: Date.now() - startedAt,
      toolJobId: result?.toolJobId ?? null,
      outputDir: result?.result?.outputDir ?? null,
      artifactCount: Array.isArray(result?.result?.artifacts) ? result.result.artifacts.length : 0,
      error: result?.ok ? null : (result?.message || result?.error || 'unknown_failure'),
    };
    records.push(record);
    if (!record.ok) break;

    outputs[step.id] = Object.fromEntries(
      (result.result.artifacts || [])
        .map((artifact) => [path.basename(artifact.path || artifact.file || ''), artifact.path || artifact.file])
        .filter(([name, full]) => name && full),
    );
  }

  process.stdout.write(`\n__CORPUS_RESULT__${JSON.stringify({ records, outputs, projectId: project.id })}\n`);
}

/** Spawn the child with the isolated environment and collect its report. */
export async function runCorpusSteps(env, { withEnrichment = false, onLog } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [SELF, '--child', JSON.stringify({ withEnrichment })],
      { env, cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'] },
    );

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('corpus generation timed out')); }, CHILD_TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; onLog?.('stdout', chunk.trimEnd()); });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; onLog?.('stderr', chunk.trimEnd()); });

    child.on('exit', (code) => {
      clearTimeout(timer);
      const marker = stdout.lastIndexOf('__CORPUS_RESULT__');
      if (marker === -1) {
        reject(new Error(`corpus child produced no result (exit ${code})\n${stderr.slice(-1500)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.slice(marker + '__CORPUS_RESULT__'.length).trim()));
      } catch (error) {
        reject(new Error(`corpus child result was unparseable: ${error.message}`));
      }
    });
  });
}

/**
 * Full corpus lifecycle: disposable root -> migrate -> run real jobs -> report.
 * Returns the root when `keep` is set so a capture run can reuse it.
 */
export async function generateCorpus({ root: reuseRoot, keep = false, withEnrichment = false, quiet = false, onLog } = {}) {
  // A caller that will later boot a server must pass its own root, so the corpus
  // and the server share one disposable environment.
  const { root, env } = createCaptureEnv({ port: 0, root: reuseRoot });
  // BLOCK-83/86 package awareness: stage the plugins these steps need from the
  // bio domain pack and point the child at the pack's tool registry. Fails
  // closed when the pack (or a required plugin) is absent.
  const toolIds = selectSteps({ withEnrichment }).map((step) => step.toolId);
  const pack = buildPackEnv({ captureRoot: root, toolIds });
  Object.assign(env, pack.env);
  try {
    await applyMigrations(env.BIOF3_DB_PATH, { quiet });
    const tables = inspectTables(env.BIOF3_DB_PATH);
    if (tables.missing.length) throw new Error(`migration left RS tables missing: ${tables.missing.join(', ')}`);

    const { records, outputs, projectId } = await runCorpusSteps(env, { withEnrichment, onLog });
    const failed = records.filter((record) => !record.ok);

    return { root, env, tables, records, outputs, projectId, pack: { root: pack.packRoot, stagedToolIds: pack.stagedToolIds }, ok: failed.length === 0 && records.length > 0, kept: keep };
  } finally {
    if (!keep && existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--child')) return runStepsInChild();

  const keep = argv.includes('--keep');
  const asJson = argv.includes('--json');
  const withEnrichment = argv.includes('--with-enrichment');
  const verbose = argv.includes('--verbose');

  const result = await generateCorpus({
    keep,
    quiet: asJson,
    withEnrichment,
    onLog: verbose ? (channel, line) => console.error(`[corpus:${channel}] ${line}`) : undefined,
  });

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('G0-RS-P4R-0 baseline corpus');
    console.log(`  disposable root : ${result.kept ? result.root : '(removed)'}`);
    console.log(`  bio pack        : ${result.pack.root} (staged: ${result.pack.stagedToolIds.join(', ')})`);
    for (const record of result.records) {
      const status = record.ok ? 'ok  ' : 'FAIL';
      console.log(`  ${status} ${record.toolId.padEnd(18)} ${String(record.durationMs).padStart(7)}ms  ${record.artifactCount} artifacts${record.error ? `  ${record.error}` : ''}`);
    }
    console.log(`\n  corpus ${result.ok ? 'complete' : 'INCOMPLETE'}`);
    // A kept corpus is ~5.5 MB. RH0 closed a gate on temp-artifact lifecycle, so
    // say how to reclaim it rather than leaving it to accumulate silently.
    if (result.kept) console.log(`\n  remove when done:  rm -rf ${result.root}`);
  }
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
