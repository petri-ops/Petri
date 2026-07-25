#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-result-studio/rs7-plugin-acceptance.json');
const productionEvidencePath = join(root, 'acceptance/harness-plugins/macos-arm64-acceptance.json');
const require = createRequire(import.meta.url);
const sdk = require('../core/shared-backend/result-studio-plugin-sdk');
const pluginIds = ['deseq2', 'volcano-plot', 'gene-correlation', 'go-kegg'];
const sha = (value) => createHash('sha256').update(String(value)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const item = (id, passed, evidence, detail) => ({ id, passed: passed === true, evidence, detail });

function inspect() {
  const production = existsSync(productionEvidencePath) ? readJson(productionEvidencePath) : { results: [] };
  const checks = [];
  let artifactCount = 0;
  for (const pluginId of pluginIds) {
    const pluginDir = join(root, 'resources/built-in-plugins', pluginId);
    const plugin = readJson(join(pluginDir, 'plugin.json'));
    const toolDefinition = readJson(join(pluginDir, 'tool-definition.json'));
    const validation = sdk.lintResultStudioPlugin({ plugin, toolDefinition, pluginDir });
    const descriptor = validation.descriptor;
    const editableOutputs = toolDefinition.outputs.filter((output) => ['plot', 'table'].includes(output.type));
    artifactCount += editableOutputs.length;
    const validProduction = (production.results || []).some((result) => result.pluginId === pluginId && result.fixtureId === 'valid' && result.ok === true && result.observedStatus === 'valid');
    checks.push(item(`RS7-${pluginId}-contract`, validation.valid, [
      `resources/built-in-plugins/${pluginId}/tool-definition.json`,
      `resources/built-in-plugins/${pluginId}/golden-revisions/result-studio-v1.json`,
    ], validation.valid ? `${editableOutputs.length} formal table/plot outputs mapped.` : validation.errors.map((x) => x.code).join(',')));
    checks.push(item(`RS7-${pluginId}-production`, validProduction, ['acceptance/harness-plugins/macos-arm64-acceptance.json'], 'The valid fixture completed through run_tool → tool_job → artifact_truth.'));
    if (descriptor) {
      const golden = readJson(join(pluginDir, descriptor.goldenFixture.path));
      const compatible = sdk.evaluateRevisionCompatibility({ descriptor, currentPluginVersion: plugin.version, revision: golden });
      const drift = sdk.evaluateRevisionCompatibility({ descriptor, currentPluginVersion: plugin.version, revision: { ...golden, artifactContractDigest: '0'.repeat(64) } });
      checks.push(item(`RS7-${pluginId}-revision`, compatible.status === 'compatible' && drift.status === 'read_only_legacy'
        && golden.independentScriptPathTemplate === descriptor.independentScriptPathTemplate,
      [`resources/built-in-plugins/${pluginId}/golden-revisions/result-studio-v1.json`],
      'Compatible history remains readable; unmigrated contract drift is explicit read-only legacy.'));
    }
  }
  checks.push(item('RS7-single-version-truth', pluginIds.every((pluginId) => {
    const definition = readJson(join(root, 'resources/built-in-plugins', pluginId, 'tool-definition.json'));
    return definition.resultStudio?.source?.strategy === 'execution_snapshot_per_artifact';
  }), ['core/shared-backend/result-changeset-service.js'], 'All adapters use canonical per-Artifact Revision snapshots; no plugin-local version system.'));
  return {
    schemaVersion: 1,
    workPackage: 'G0-RS7',
    sourceCommit: git('rev-parse', 'HEAD'),
    privacy: 'digests_counts_and_repository_relative_paths_only',
    pluginCount: pluginIds.length,
    formalArtifactCount: artifactCount,
    productionEvidenceSha256: existsSync(productionEvidencePath) ? sha(readFileSync(productionEvidencePath)) : null,
    checks,
    passed: checks.every((check) => check.passed),
  };
}

try {
  const report = inspect();
  if (!report.passed) throw new Error(report.checks.filter((check) => !check.passed).map((check) => check.id).join(','));
  if (process.argv.includes('--write-evidence')) {
    const output = { ...report, generatedAt: new Date().toISOString() };
    mkdirSync(dirname(evidencePath), { recursive: true });
    writeFileSync(evidencePath, `${JSON.stringify(output, null, 2)}\n`);
    console.log(`[G0-RS7] PASS — evidence updated (${report.checks.length}/${report.checks.length})`);
  } else {
    if (!existsSync(evidencePath)) throw new Error('evidence missing; run npm run g0:result-studio:plugin:update');
    const stored = readJson(evidencePath);
    if (!stored.passed || stored.productionEvidenceSha256 !== report.productionEvidenceSha256
        || stored.pluginCount !== report.pluginCount || stored.formalArtifactCount !== report.formalArtifactCount) {
      throw new Error('stored RS7 evidence is stale or invalid');
    }
    console.log(`[G0-RS7] PASS — ${report.checks.length}/${report.checks.length}`);
  }
} catch (error) {
  console.error(`[G0-RS7] FAIL — ${error.message}`);
  process.exitCode = 1;
}
