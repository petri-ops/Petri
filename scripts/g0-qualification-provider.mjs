#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runProbesForTarget, scoreTarget } from './harness-provider-eval.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const evidencePath = join(root, 'acceptance/g0-qualification/real-provider.json');
const require = createRequire(import.meta.url);
const qualification = require('../core/shared-backend/g0-baseline-qualification');
const aiSettings = require('../core/biof3-server/helpers/ai-settings');
const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

function credentialFor(profile) {
  const ref = String(profile.credentialRef || `provider:${profile.provider}`);
  const id = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
  return aiSettings.getApiKey(id) || '';
}

export function resolveProductTargets(
  settings = aiSettings.getAiSettings(),
  getCredential = credentialFor,
) {
  const profiles = Array.isArray(settings.model_profiles) ? settings.model_profiles : [];
  const targets = [];
  for (const profile of profiles) {
    if (!profile || !['deepseek', 'openai-compatible', 'ollama', 'lmstudio', 'vllm'].includes(profile.provider)) continue;
    if (!Array.isArray(profile.capabilities) || !profile.capabilities.includes('chat') || !profile.capabilities.includes('tools')) continue;
    const apiKey = getCredential(profile);
    if (!apiKey && !['ollama', 'lmstudio', 'vllm'].includes(profile.provider)) continue;
    if (!profile.model) continue;
    targets.push({
      name: `qualification-target-${targets.length + 1}`,
      provider: profile.provider,
      model: profile.model,
      baseUrl: profile.baseUrl,
      apiKey,
    });
  }
  return targets;
}

export async function runLive({
  settings = aiSettings.getAiSettings(),
  getCredential = credentialFor,
  probeRunner = runProbesForTarget,
} = {}) {
  const subject = qualification.buildQualificationManifest();
  const targets = resolveProductTargets(settings, getCredential);
  const results = [];
  const passedProviderClasses = new Set();
  for (const target of targets) {
    // A provider class is qualified by its first passing configured target.
    // Failed candidates remain in the bounded report, while later profiles of
    // the same protocol still get a chance to prove the class.
    if (passedProviderClasses.has(target.provider)) continue;
    console.log(`[G0-LF12 provider] evaluating ${target.name} (${target.provider})`);
    let scored;
    try {
      const probes = await probeRunner(target);
      scored = scoreTarget(target.name, probes);
    } catch {
      scored = scoreTarget(target.name, {
        intent: { ok: false, failure: 'provider_exception', detail: 'bounded provider exception' },
      });
    }
    results.push({
      targetId: target.name,
      providerClass: target.provider,
      passedBar: scored.passedBar,
      passedProbeCount: scored.passed,
      totalProbeCount: scored.total,
      requiredFailures: [...scored.requiredFailures],
      failureCodes: scored.failures.map((item) => `${item.probe}:${item.failure}`),
      probeStatus: Object.fromEntries(Object.entries(scored.probes).map(([id, value]) => [id, value?.ok === true])),
    });
    if (scored.passedBar) passedProviderClasses.add(target.provider);
  }
  const passed = results.filter((item) => item.passedBar);
  const uniquePassedProviders = new Set(passed.map((item) => item.providerClass));
  return {
    schemaVersion: 1,
    qualificationId: 'g0-baseline-v1-qualification',
    sourceCommit: git('rev-parse', 'HEAD'),
    baseline: {
      baselineId: subject.subjectBaselineId,
      baselineVersion: subject.subjectBaselineVersion,
      bundleDigest: subject.bundleDigest,
    },
    platform: 'macos-arm64',
    architecture: 'arm64',
    appMode: 'real-provider-qualification',
    privacy: 'target_ids_provider_classes_probe_booleans_failure_codes_and_hashes_only_no_credentials_urls_models_or_responses',
    requiredProviderCount: 2,
    discoveredProviderClasses: [...new Set(results.map((item) => item.providerClass))].sort(),
    passedProviderClasses: [...uniquePassedProviders].sort(),
    results,
    runnerHashes: {
      qualificationProviderSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
      providerEvalSha256: sha256(readFileSync(join(root, 'scripts/harness-provider-eval.mjs'))),
    },
    passed: passed.length >= 2 && uniquePassedProviders.size >= 2,
    generatedAt: new Date().toISOString(),
  };
}

function isAncestor(commit) {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function verifyStored() {
  if (!existsSync(evidencePath)) throw new Error('real_provider_evidence_missing');
  const stored = JSON.parse(readFileSync(evidencePath, 'utf8'));
  const subject = qualification.buildQualificationManifest();
  if (!stored.passed) throw new Error('real_provider_qualification_failed');
  if (!isAncestor(stored.sourceCommit)) throw new Error('real_provider_source_not_ancestor');
  if (stored.baseline?.bundleDigest !== subject.bundleDigest) throw new Error('real_provider_baseline_stale');
  if (!Array.isArray(stored.passedProviderClasses) || new Set(stored.passedProviderClasses).size < 2) {
    throw new Error('real_provider_classes_insufficient');
  }
  if (
    stored.runnerHashes?.qualificationProviderSha256 !== sha256(readFileSync(fileURLToPath(import.meta.url)))
    || stored.runnerHashes?.providerEvalSha256 !== sha256(readFileSync(join(root, 'scripts/harness-provider-eval.mjs')))
  ) throw new Error('real_provider_runner_stale');
  const serialized = JSON.stringify(stored);
  if (/https?:\/\//i.test(serialized) || /Bearer\s+/i.test(serialized) || /sk-[A-Za-z0-9]{12,}/.test(serialized)) {
    throw new Error('real_provider_evidence_privacy_failure');
  }
  return stored;
}

export async function main(argv = process.argv.slice(2)) {
  try {
    if (argv.includes('--write-evidence')) {
      const report = await runLive();
      mkdirSync(dirname(evidencePath), { recursive: true });
      // A bounded failed report is evidence of the gap and must not disappear.
      writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
      if (!report.passed) {
        throw new Error(`real_provider_qualification_failed:${report.passedProviderClasses.length}/${report.requiredProviderCount}`);
      }
      console.log(`[G0-LF12 provider] PASS — ${report.passedProviderClasses.length}/${report.requiredProviderCount} provider classes`);
    } else {
      const stored = verifyStored();
      console.log(`[G0-LF12 provider] PASS — ${stored.passedProviderClasses.length}/${stored.requiredProviderCount} provider classes`);
    }
  } catch (error) {
    console.error(`[G0-LF12 provider] FAIL — ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
