#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsRoot = path.join(root, 'resources', 'built-in-plugins');
const evidenceDir = path.join(root, 'acceptance', 'harness-plugins');
const evidenceJson = path.join(evidenceDir, 'macos-arm64-acceptance.json');
const evidenceMd = path.join(evidenceDir, 'macos-arm64-acceptance.md');
const mode = process.argv.includes('--verify-evidence') ? 'verify' : 'run';
const selected = process.argv.filter((arg) => !arg.startsWith('--')).slice(2);

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function compactError(value) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 800); }
function sha(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }

function pluginIds() {
  return fs.readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((id) => fs.existsSync(path.join(pluginsRoot, id, 'acceptance.json')))
    .filter((id) => selected.length === 0 || selected.includes(id))
    .sort();
}

function resolveFixtureInputs(pluginDir, definition, fixture) {
  const params = { ...(fixture.inputs || {}) };
  for (const input of definition.inputs || []) {
    if (input.type !== 'file' || typeof params[input.id] !== 'string') continue;
    if (!path.isAbsolute(params[input.id])) params[input.id] = path.join(pluginDir, params[input.id]);
  }
  return params;
}

function failureCodeFor(result, definition) {
  const structured = result?.result?.manifest || result?.result;
  if (structured?.failureMode) return structured.failureMode;
  if (result && result.error && result.error !== 'tool_failed') return result.error;
  const text = compactError(result && (result.message || result.error));
  for (const modeDef of definition.failureModes || []) {
    if (!modeDef || !modeDef.code || !modeDef.detect) continue;
    try { if (new RegExp(modeDef.detect, 'i').test(text)) return modeDef.code; } catch {}
  }
  return result?.error || 'tool_failed';
}

function validateReproducibility(parsed, expectedOutputNames) {
  const provenance = parsed?.executionProvenance;
  const errors = [];
  if (!provenance) return ['execution_provenance_missing'];
  if (!sha(provenance.provenanceHash)) errors.push('provenance_hash_missing');
  if (!sha(provenance.script?.sha256)) errors.push('script_hash_missing');
  if (!sha(provenance.params?.sha256)) errors.push('params_hash_missing');
  if (!provenance.runtime?.version || provenance.runtime.version === '0.0.0') errors.push('runtime_version_missing');
  if (Object.keys(provenance.plugin?.packageConstraints || {}).length === 0) errors.push('package_constraints_missing');
  if (!(provenance.inputs || []).length || provenance.inputs.some((input) => !sha(input.sha256))) {
    errors.push('input_hash_missing');
  }
  const artifactHashes = new Map((provenance.artifacts || []).map((item) => [item.filename, item.sha256]));
  for (const filename of expectedOutputNames) {
    if (!sha(artifactHashes.get(filename))) errors.push(`output_hash_missing:${filename}`);
  }
  const manifestPath = path.join(parsed.resultDir || parsed.outputDir || '', 'artifact-manifest.json');
  if (!fs.existsSync(manifestPath)) errors.push('artifact_manifest_missing');
  else {
    const manifest = readJson(manifestPath);
    if (!sha(manifest.reproducibility?.scriptSha256)) errors.push('artifact_manifest_script_hash_missing');
    if (!sha(manifest.reproducibility?.paramsSha256)) errors.push('artifact_manifest_params_hash_missing');
  }
  return errors;
}

async function runAcceptance() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-plugin-acceptance-'));
  process.env.BIOF3_LOCAL_RESULTS_DIR = path.join(tempRoot, 'results');
  process.env.BIOF3_LOCAL_DATA_DIR = path.join(tempRoot, 'data');
  process.env.BIOF3_DB_PATH = path.join(tempRoot, 'biof3.db');
  process.env.BIOF3_HARNESS_LOCAL_ROOT = path.join(tempRoot, 'results');
  // 验收内置源码本身，不能让用户目录中的已安装旧版本覆盖 built-in。
  process.env.BIOF3_PLUGINS_DIR = path.join(tempRoot, 'plugins');
  fs.mkdirSync(process.env.BIOF3_PLUGINS_DIR, { recursive: true });
  const { tool_run_tool } = require('../core/biof3-server/agent-tools/learning');
  const results = [];
  try {
    for (const id of pluginIds()) {
      const pluginDir = path.join(pluginsRoot, id);
      const acceptance = readJson(path.join(pluginDir, 'acceptance.json'));
      const definition = readJson(path.join(pluginDir, 'tool-definition.json'));
      for (const fixture of acceptance.fixtures || []) {
        if (fixture.skipOnSupportedPlatform) {
          results.push({ pluginId: id, fixtureId: fixture.id, status: 'skipped', reason: 'negative runtime fixture is not applicable on supported macOS runtime' });
          continue;
        }
        const startedAt = Date.now();
        const params = resolveFixtureInputs(pluginDir, definition, fixture);
        const result = await tool_run_tool(
          { op: 'run', toolId: id, params },
          { userId: '__plugin_acceptance__', accessMode: 'full', allowExecution: true }
        );
        const expectedStatus = fixture.expectedStatus || 'valid';
        if (expectedStatus === 'blocked') {
          const observedFailureMode = failureCodeFor(result, definition);
          const ok = result.ok === false && observedFailureMode === fixture.expectedFailureMode;
          results.push({
            pluginId: id,
            fixtureId: fixture.id,
            expectedStatus,
            observedStatus: result.ok === false ? 'blocked' : 'valid',
            expectedFailureMode: fixture.expectedFailureMode,
            observedFailureMode,
            ok,
            durationMs: Date.now() - startedAt,
            error: ok ? null : compactError(result.message || result.error),
          });
          continue;
        }
        const parsed = result.result && typeof result.result === 'object' ? result.result : null;
        const actualNames = new Set((parsed?.artifacts || []).map((item) => item.filename || item.name));
        const missingOutputs = (fixture.expectedOutputs || []).filter((name) => !actualNames.has(name));
        const reproducibilityErrors = result.ok
          ? validateReproducibility(parsed, fixture.expectedOutputs || [])
          : ['execution_failed'];
        const ok = result.ok === true && missingOutputs.length === 0 && reproducibilityErrors.length === 0;
        results.push({
          pluginId: id,
          fixtureId: fixture.id,
          expectedStatus,
          observedStatus: result.ok ? (parsed?.artifactTruth?.status || 'valid') : 'failed',
          ok,
          durationMs: Date.now() - startedAt,
          toolJobId: result.toolJobId || null,
          missingOutputs,
          reproducibilityErrors,
          artifactCount: parsed?.artifacts?.length || 0,
          provenanceHash: parsed?.executionProvenance?.provenanceHash || null,
          error: ok ? null : compactError(
            parsed?.artifactDiagnostics?.map((item) => `${item.code}: ${item.message}`).join('; ') ||
            result.message || result.error
          ),
        });
      }
    }
    const passed = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => item.ok === false).length;
    const skipped = results.filter((item) => item.status === 'skipped').length;
    const report = {
      schemaVersion: 1,
      platform: `${process.platform}-${process.arch}`,
      generatedAt: new Date().toISOString(),
      source: 'production run_tool -> tool_job -> artifact truth',
      pluginCount: new Set(results.map((item) => item.pluginId)).size,
      summary: { total: results.length, passed, failed, skipped },
      results,
    };
    fs.mkdirSync(evidenceDir, { recursive: true });
    fs.writeFileSync(evidenceJson, JSON.stringify(report, null, 2));
    const rows = results.map((item) => `| ${item.pluginId} | ${item.fixtureId} | ${item.ok ? 'PASS' : item.status === 'skipped' ? 'SKIP' : 'FAIL'} | ${item.observedStatus || item.reason || '-'} | ${item.durationMs ?? '-'} | ${item.error || (item.reproducibilityErrors || []).join(', ') || '-'} |`);
    fs.writeFileSync(evidenceMd, `# Built-in plugin acceptance — ${report.platform}\n\nGenerated: ${report.generatedAt}\n\nProduction path: \`${report.source}\`\n\nSummary: **${passed} passed / ${failed} failed / ${skipped} skipped**\n\n| Plugin | Fixture | Result | Observed | ms | Evidence / error |\n|---|---|---:|---|---:|---|\n${rows.join('\n')}\n`);
    for (const item of results) console.log(`${item.ok ? 'PASS' : item.status === 'skipped' ? 'SKIP' : 'FAIL'} ${item.pluginId}:${item.fixtureId}${item.error ? ` — ${item.error}` : ''}`);
    console.log(`[plugins] ${passed} passed / ${failed} failed / ${skipped} skipped`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    if (process.env.BIOF3_KEEP_PLUGIN_ACCEPTANCE_TEMP === '1') {
      console.log(`[plugins] preserved temp root: ${tempRoot}`);
    } else {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

function verifyEvidence() {
  if (!fs.existsSync(evidenceJson)) throw new Error('plugin_acceptance_evidence_missing');
  const report = readJson(evidenceJson);
  if (report.platform !== 'darwin-arm64') throw new Error(`unsupported_evidence_platform:${report.platform}`);
  if (report.summary?.failed !== 0) throw new Error(`plugin_acceptance_failures:${report.summary?.failed}`);
  if (report.pluginCount !== 10) throw new Error(`plugin_acceptance_plugin_count:${report.pluginCount}`);
  console.log(`[plugins] evidence verified: ${report.summary.passed} passed / ${report.summary.skipped} skipped`);
}

if (mode === 'verify') verifyEvidence();
else await runAcceptance();
