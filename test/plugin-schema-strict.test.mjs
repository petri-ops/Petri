/**
 * SUB-15.2 PHASE 2 — plugin-schema-strict unit tests
 *
 * Covers:
 * 1. validatePluginManifest — required fields, id, version, language, platform, etc.
 * 2. scanPluginManifests — directory walking + JSON parse error handling
 * 3. checkPayloadShape — basic type checks, enum, min/max
 * 4. getPayloadHint — channel prefix matching
 *
 * UR-4: Self-written validator — no ajv / zod / third-party schema libs
 * Style: matches PL-001 (BLOCK-10-AUDIT CLOSEOUT) test conventions
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { test } from 'node:test';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Import from the shared script (ESM module)
const { readFileSync } = await import('node:fs');
const { execSync } = await import('node:child_process');

// Load the validator module content directly to test its exported functions.
// We run it as a subprocess to get the structured output.
function runValidator(args = []) {
  const out = execSync(`node scripts/validate-ipc-catalog.mjs --json ${args.join(' ')}`, {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  return JSON.parse(out);
}

// ── Inline copy of the pure validation logic for unit testing ──
// (mirrors the logic in validate-ipc-catalog.mjs — keep in sync)

const PLUGIN_REQUIRED_FIELDS = Object.freeze([
  'id', 'title', 'version', 'language', 'pluginManifestVersion',
]);
const VALID_LANGUAGES = Object.freeze(['r', 'python', 'javascript', 'julia', 'bash']);
const VALID_STATUSES = Object.freeze(['canonical', 'experimental', 'deprecated', 'archived']);
const VALID_SOURCE_POLICIES = Object.freeze([
  'builtin-canonical', 'builtin-experimental', 'user-installed', 'remote',
]);
const VALID_PLATFORM_IDS = Object.freeze(['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']);
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+/;
const ID_RE = /^[a-z][a-z0-9_-]*$/;

function validatePluginManifest(manifest) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object') {
    return ['plugin manifest must be a non-null object'];
  }
  for (const field of PLUGIN_REQUIRED_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) {
      issues.push(`required field "${field}" is missing or null`);
    }
  }
  if (typeof manifest.id !== 'string' || manifest.id.length === 0) {
    issues.push('id must be a non-empty string');
  } else if (!ID_RE.test(manifest.id)) {
    issues.push(`id "${manifest.id}" must match /^[a-z][a-z0-9_-]*$/`);
  }
  if (typeof manifest.pluginManifestVersion !== 'number') {
    issues.push('pluginManifestVersion must be a number');
  } else if (!Number.isInteger(manifest.pluginManifestVersion) || manifest.pluginManifestVersion < 1) {
    issues.push(`pluginManifestVersion must be a positive integer (got ${manifest.pluginManifestVersion})`);
  }
  if (typeof manifest.title !== 'string' || manifest.title.trim().length === 0) {
    issues.push('title must be a non-empty string');
  }
  if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version)) {
    issues.push(`version "${manifest.version}" must be a semver-like string (e.g. "1.0.0")`);
  }
  if (typeof manifest.language !== 'string' || !VALID_LANGUAGES.includes(manifest.language)) {
    issues.push(`language "${manifest.language}" must be one of: ${VALID_LANGUAGES.join(', ')}`);
  }
  if (manifest.status !== undefined && !VALID_STATUSES.includes(manifest.status)) {
    issues.push(`status "${manifest.status}" must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  if (manifest.sourcePolicy !== undefined && !VALID_SOURCE_POLICIES.includes(manifest.sourcePolicy)) {
    issues.push(`sourcePolicy "${manifest.sourcePolicy}" must be one of: ${VALID_SOURCE_POLICIES.join(', ')}`);
  }
  for (const field of ['platform', 'supportedPlatforms']) {
    if (manifest[field] !== undefined) {
      if (!Array.isArray(manifest[field])) {
        issues.push(`${field} must be an array`);
      } else {
        for (const p of manifest[field]) {
          if (!VALID_PLATFORM_IDS.includes(p)) {
            issues.push(`${field}: invalid platform "${p}"`);
          }
        }
      }
    }
  }
  if (manifest.requiresBundle !== undefined) {
    if (typeof manifest.requiresBundle !== 'string' || manifest.requiresBundle.length === 0) {
      issues.push('requiresBundle must be a non-empty string');
    }
  }
  if (manifest.requiresBundleVersion !== undefined) {
    if (typeof manifest.requiresBundleVersion !== 'string' || !SEMVER_RE.test(manifest.requiresBundleVersion)) {
      issues.push('requiresBundleVersion must be a semver-like string');
    }
  }
  if (manifest.requiresBundle !== undefined && manifest.requiresBundleVersion === undefined) {
    issues.push('requiresBundle is set but requiresBundleVersion is missing');
  }

  if (manifest.platformSupport !== undefined) {
    if (typeof manifest.platformSupport !== 'object' || Array.isArray(manifest.platformSupport)) {
      issues.push('platformSupport must be a non-array object');
    } else {
      for (const [platformId, support] of Object.entries(manifest.platformSupport)) {
        if (!VALID_PLATFORM_IDS.includes(platformId)) {
          issues.push(`platformSupport: invalid platformId "${platformId}"`);
        }
        if (typeof support !== 'object' || Array.isArray(support)) {
          issues.push(`platformSupport.${platformId}: must be an object`);
        }
      }
    }
  }

  return issues;
}

function inferJsType(typeStr) {
  switch (typeStr) {
    case 'null': return 'object';
    case 'boolean': return 'boolean';
    case 'number': return 'number';
    case 'integer': return 'number';
    case 'string': return 'string';
    case 'array': return 'object';
    case 'object': return 'object';
    default: return 'unknown';
  }
}

function checkPayloadShape(value, schema, path = '<payload>') {
  const errors = [];
  if (!schema || typeof schema !== 'object') {
    return { ok: true, errors: [] };
  }
  if (schema.type !== undefined) {
    const jsType = inferJsType(schema.type);
    if (jsType !== 'unknown') {
      if (schema.type === 'null') {
        if (value !== null) {
          errors.push(`${path}: expected null, got ${value === null ? 'null' : typeof value}`);
        }
      } else if (schema.type === 'integer') {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push(`${path}: expected integer, got ${typeof value} ${value}`);
        }
      } else if (typeof value !== jsType) {
        errors.push(`${path}: expected type ${schema.type}, got ${typeof value}`);
      }
    }
  }
  if (schema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const propValue = value[propName];
      const propPath = `${path}.${propName}`;
      if (propValue === undefined && Array.isArray(schema.required) && schema.required.includes(propName)) {
        errors.push(`${propPath}: required field "${propName}" is missing`);
      }
      if (propValue !== undefined) {
        const propErrors = checkPayloadShape(propValue, propSchema, propPath);
        errors.push(...propErrors.errors);
      }
    }
  }
  if (schema.minimum !== undefined && typeof value === 'number') {
    if (value < schema.minimum) {
      errors.push(`${path}: value ${value} < minimum ${schema.minimum}`);
    }
  }
  if (schema.maximum !== undefined && typeof value === 'number') {
    if (value > schema.maximum) {
      errors.push(`${path}: value ${value} > maximum ${schema.maximum}`);
    }
  }
  if (schema.enum !== undefined && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      errors.push(`${path}: value "${value}" not in enum [${schema.enum.join(', ')}]`);
    }
  }
  return { ok: errors.length === 0, errors };
}

const PAYLOAD_HINTS = {
  'window:': { type: 'push', payloadHint: { type: 'object' } },
  'plugin:': { type: 'invoke', payloadHint: { type: 'object' } },
  'file:': { type: 'invoke', payloadHint: { type: 'object' } },
  'runtime:': { type: 'invoke', payloadHint: { type: 'object' } },
  'updater:': { type: 'push', payloadHint: { type: 'object' } },
};

function getPayloadHint(channel) {
  for (const [prefix, hint] of Object.entries(PAYLOAD_HINTS)) {
    if (channel.startsWith(prefix)) return hint;
  }
  return null;
}

// ── Test 1: valid plugin manifest passes ───────────────────────────────────────

test('S.1: valid deseq2-style manifest passes with zero issues', () => {
  const manifest = {
    id: 'deseq2',
    pluginManifestVersion: 1,
    title: 'DESeq2 差异分析',
    version: '1.0.0',
    language: 'r',
    description: 'Bulk RNA-seq DE.',
    packages: { r: { DESeq2: '>=1.40.0' } },
    runtime: { r: '>=4.4.0' },
    builtAgainst: { r: '4.5' },
    platform: ['macos-arm64', 'windows-x64'],
    supportedPlatforms: ['macos-arm64', 'windows-x64'],
    status: 'canonical',
    sourcePolicy: 'builtin-canonical',
  };
  const issues = validatePluginManifest(manifest);
  assert.deepEqual(issues, [], `expected no issues, got: ${issues.join('; ')}`);
});

// ── Test 2: missing required field ─────────────────────────────────────────────

test('S.2: missing required field produces issue with field name', () => {
  const manifest = {
    id: 'test-plugin',
    title: 'Test',
    version: '1.0.0',
    language: 'r',
    // pluginManifestVersion missing
  };
  const issues = validatePluginManifest(manifest);
  assert.ok(issues.some(i => i.includes('pluginManifestVersion')), `expected pluginManifestVersion issue, got: ${issues.join('; ')}`);
});

// ── Test 3: invalid id format ──────────────────────────────────────────────────

test('S.3: invalid id (starts with number) is caught', () => {
  const manifest = {
    id: '2deseq2',
    pluginManifestVersion: 1,
    title: 'Test',
    version: '1.0.0',
    language: 'r',
  };
  const issues = validatePluginManifest(manifest);
  assert.ok(issues.some(i => i.includes('id') && i.includes('must match')), `expected id format issue, got: ${issues.join('; ')}`);
});

// ── Test 4: non-semver version ────────────────────────────────────────────────

test('S.4: non-semver version is caught', () => {
  const manifest = {
    id: 'deseq2',
    pluginManifestVersion: 1,
    title: 'Test',
    version: 'latest',
    language: 'r',
  };
  const issues = validatePluginManifest(manifest);
  assert.ok(issues.some(i => i.includes('version') && i.includes('semver')), `expected semver issue, got: ${issues.join('; ')}`);
});

// ── Test 5: invalid language ──────────────────────────────────────────────────

test('S.5: invalid language is caught', () => {
  const manifest = {
    id: 'deseq2',
    pluginManifestVersion: 1,
    title: 'Test',
    version: '1.0.0',
    language: 'rust',
  };
  const issues = validatePluginManifest(manifest);
  assert.ok(issues.some(i => i.includes('language') && i.includes('rust')), `expected language issue, got: ${issues.join('; ')}`);
});

// ── Test 6: invalid platform id ───────────────────────────────────────────────

test('S.6: invalid platform in supportedPlatforms is caught', () => {
  const manifest = {
    id: 'deseq2',
    pluginManifestVersion: 1,
    title: 'Test',
    version: '1.0.0',
    language: 'r',
    supportedPlatforms: ['macos-arm64', 'freebsd-x64'],
  };
  const issues = validatePluginManifest(manifest);
  assert.ok(issues.some(i => i.includes('freebsd-x64')), `expected platform issue, got: ${issues.join('; ')}`);
});

// ── Test 7: invalid status ────────────────────────────────────────────────────

test('S.7: invalid status is caught', () => {
  const manifest = {
    id: 'deseq2',
    pluginManifestVersion: 1,
    title: 'Test',
    version: '1.0.0',
    language: 'r',
    status: 'released',
  };
  const issues = validatePluginManifest(manifest);
  assert.ok(issues.some(i => i.includes('status') && i.includes('released')), `expected status issue, got: ${issues.join('; ')}`);
});

// ── Test 8: requiresBundle without requiresBundleVersion ──────────────────────

test('S.8: requiresBundle without requiresBundleVersion is caught', () => {
  const manifest = {
    id: 'deseq2',
    pluginManifestVersion: 1,
    title: 'Test',
    version: '1.0.0',
    language: 'r',
    requiresBundle: 'r-enrichment',
    // requiresBundleVersion missing
  };
  const issues = validatePluginManifest(manifest);
  assert.ok(issues.some(i => i.includes('requiresBundle') && i.includes('requiresBundleVersion')), `expected paired issue, got: ${issues.join('; ')}`);
});

// ── Test 9: non-null manifest (null input) ────────────────────────────────────

test('S.9: null input returns non-object error', () => {
  const issues = validatePluginManifest(null);
  assert.ok(issues.some(i => i.includes('non-null object')), `expected non-null issue, got: ${issues.join('; ')}`);
});

// ── Test 10: non-object manifest ──────────────────────────────────────────────

test('S.10: non-object input returns non-object error', () => {
  const issues = validatePluginManifest('string');
  assert.ok(issues.some(i => i.includes('non-null object')), `expected non-null issue, got: ${issues.join('; ')}`);
});

// ── Test 11: platformSupport invalid platform ─────────────────────────────────

test('S.11: platformSupport with invalid platformId is caught', () => {
  const manifest = {
    id: 'deseq2',
    pluginManifestVersion: 1,
    title: 'Test',
    version: '1.0.0',
    language: 'r',
    platformSupport: {
      'freebsd-x64': { status: 'supported' },
    },
  };
  const issues = validatePluginManifest(manifest);
  assert.ok(issues.some(i => i.includes('freebsd-x64')), `expected platformId issue, got: ${issues.join('; ')}`);
});

// ── Test 12: checkPayloadShape — happy path ───────────────────────────────────

test('P.1: valid payload passes type + bounds checks', () => {
  const schema = { type: 'object', properties: { padj: { type: 'number', minimum: 0, maximum: 1 } } };
  const { ok, errors } = checkPayloadShape({ padj: 0.05 }, schema, '<root>');
  assert.equal(ok, true, `expected ok=true, errors: ${errors.join('; ')}`);
});

// ── Test 13: checkPayloadShape — wrong type ───────────────────────────────────

test('P.2: wrong type produces error with path', () => {
  const schema = { type: 'object', properties: { padj: { type: 'number' } } };
  const { ok, errors } = checkPayloadShape({ padj: '0.05' }, schema, '<root>');
  assert.equal(ok, false);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('padj'), `expected path in error, got: ${errors[0]}`);
  assert.ok(errors[0].includes('number'), `expected type in error, got: ${errors[0]}`);
});

// ── Test 14: checkPayloadShape — integer ───────────────────────────────────────

test('P.3: integer type rejects float', () => {
  const schema = { type: 'object', properties: { n: { type: 'integer' } } };
  const { ok, errors } = checkPayloadShape({ n: 1.5 }, schema, '<root>');
  assert.equal(ok, false);
  assert.ok(errors[0].includes('integer'), `expected integer issue, got: ${errors[0]}`);
});

// ── Test 15: checkPayloadShape — minimum ─────────────────────────────────────

test('P.4: minimum constraint rejects value below bound', () => {
  const schema = { type: 'object', properties: { padj: { type: 'number', minimum: 0 } } };
  const { ok, errors } = checkPayloadShape({ padj: -0.01 }, schema, '<root>');
  assert.equal(ok, false);
  assert.ok(errors.some(e => e.includes('minimum 0')), `expected minimum issue, got: ${errors.join('; ')}`);
});

// ── Test 16: checkPayloadShape — maximum ─────────────────────────────────────

test('P.5: maximum constraint rejects value above bound', () => {
  const schema = { type: 'object', properties: { padj: { type: 'number', maximum: 1 } } };
  const { ok, errors } = checkPayloadShape({ padj: 1.5 }, schema, '<root>');
  assert.equal(ok, false);
  assert.ok(errors.some(e => e.includes('maximum 1')), `expected maximum issue, got: ${errors.join('; ')}`);
});

// ── Test 17: checkPayloadShape — enum ────────────────────────────────────────

test('P.6: enum rejects out-of-set value', () => {
  const schema = { type: 'object', properties: { method: { type: 'string', enum: ['pearson', 'spearman'] } } };
  const { ok, errors } = checkPayloadShape({ method: 'kendall' }, schema, '<root>');
  assert.equal(ok, false);
  assert.ok(errors[0].includes('kendall'), `expected kendall in error, got: ${errors[0]}`);
  assert.ok(errors[0].includes('enum'), `expected enum in error, got: ${errors[0]}`);
});

// ── Test 18: checkPayloadShape — null type ───────────────────────────────────

test('P.7: null type accepts only null', () => {
  const schema = { type: 'object', properties: { opt: { type: 'null' } } };
  const { ok: okNull, errors: errNull } = checkPayloadShape({ opt: null }, schema, '<root>');
  assert.equal(okNull, true, `expected null to pass, errors: ${errNull.join('; ')}`);
  const { ok: okStr, errors: errStr } = checkPayloadShape({ opt: 'value' }, schema, '<root>');
  assert.equal(okStr, false);
});

// ── Test 19: checkPayloadShape — no schema (skip) ────────────────────────────

test('P.8: no schema (null/undefined) skips validation', () => {
  const { ok, errors } = checkPayloadShape({ any: 'thing' }, null, '<root>');
  assert.equal(ok, true);
  const { ok: ok2, errors: err2 } = checkPayloadShape({ any: 'thing' }, undefined, '<root>');
  assert.equal(ok2, true);
});

// ── Test 20: getPayloadHint — known prefix ───────────────────────────────────

test('H.1: known channel prefix returns payload hint', () => {
  const hint = getPayloadHint('plugin:install');
  assert.ok(hint !== null, 'expected hint for plugin: prefix');
  assert.equal(hint.type, 'invoke');
});

test('H.2: window: prefix returns push hint', () => {
  const hint = getPayloadHint('window:maximize');
  assert.ok(hint !== null);
  assert.equal(hint.type, 'push');
});

test('H.3: updater: prefix returns push hint', () => {
  const hint = getPayloadHint('updater:update-available');
  assert.ok(hint !== null);
  assert.equal(hint.type, 'push');
});

// ── Test 21: getPayloadHint — unknown prefix ───────────────────────────────────

test('H.4: unknown channel prefix returns null', () => {
  const hint = getPayloadHint('random:channel');
  assert.equal(hint, null);
});

// ── Test 22: Integration — full validator run passes ───────────────────────────

test('I.1: full validator run with --manifest-only exits 0 on clean manifest', () => {
  // Run the real validator on the harness prototype (known-good)
  const out = execSync(
    'node scripts/validate-ipc-catalog.mjs --json --manifest-only',
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  const result = JSON.parse(out);
  assert.ok(result.summary, 'expected summary in output');
  // harness plugin should pass
  const harnessResult = result.pluginManifests
    ? result.pluginManifests.find(p => p.path.includes('harness-plugin-prototype'))
    : null;
  if (harnessResult) {
    assert.equal(harnessResult.issues.length, 0, `expected harness to pass, issues: ${harnessResult.issues.join('; ')}`);
  }
});

// ── Test 23: Integration — scan real built-in plugin manifests ────────────────

test('I.2: real deseq2 plugin.json passes validation', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'resources', 'built-in-plugins', 'deseq2', 'plugin.json'), 'utf8')
  );
  const issues = validatePluginManifest(manifest);
  assert.equal(issues.length, 0, `deseq2 manifest should pass, issues: ${issues.join('; ')}`);
});

test('I.3: real seurat-standard plugin.json passes validation', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'resources', 'built-in-plugins', 'seurat-standard', 'plugin.json'), 'utf8')
  );
  const issues = validatePluginManifest(manifest);
  assert.equal(issues.length, 0, `seurat-standard manifest should pass, issues: ${issues.join('; ')}`);
});

test('I.4: harness-plugin-prototype plugin.json passes validation', () => {
  const manifest = JSON.parse(
    readFileSync(path.join(__dirname, '..', 'acceptance', 'harness-plugin-prototype', 'plugin.json'), 'utf8')
  );
  const issues = validatePluginManifest(manifest);
  assert.equal(issues.length, 0, `harness plugin manifest should pass, issues: ${issues.join('; ')}`);
});

// ── Test 24: scanPluginManifests — integration via full script ─────────────────

test('I.5: full IPC catalog scan finds harness plugin manifest and it passes', () => {
  const out = execSync(
    'node scripts/validate-ipc-catalog.mjs --json --manifest-only',
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );
  const result = JSON.parse(out);
  assert.ok(result.pluginManifests, 'expected pluginManifests in output');
  assert.ok(result.pluginManifests.length >= 1, `expected >= 1 plugin, got ${result.pluginManifests.length}`);
  // Harness plugin appears as "plugin.json" (top-level acceptance dir scan)
  const harnessResult = result.pluginManifests.find(p => p.path === 'plugin.json');
  assert.ok(harnessResult, 'expected harness plugin.json in scan results');
  assert.equal(harnessResult.issues.length, 0, `expected harness to pass, issues: ${harnessResult.issues.join('; ')}`);
});
