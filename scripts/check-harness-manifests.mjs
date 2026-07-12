#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BUILT_IN_DIR = path.join(REPO_ROOT, 'resources', 'built-in-plugins');
const require = createRequire(import.meta.url);
const pluginLoader = require(path.join(REPO_ROOT, 'vendor', 'biof3-core', 'r-server', 'plugin-loader.js'));

const ARTIFACT_TYPES = new Set(['plot', 'table', 'text', 'json', 'html', 'file', 'log']);
const LANGUAGES = new Set(['r', 'python']);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertField(errors, condition, message) {
  if (!condition) errors.push(message);
}

function assertUniqueKeys(errors, items, key, label, itemLabel) {
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const value = item && item[key];
    if (!value) continue;
    if (seen.has(value)) {
      errors.push(`${label}: duplicate ${itemLabel} ${key} "${value}"`);
      continue;
    }
    seen.add(value);
  }
}

function runnableBuiltInPluginDirs(root = BUILT_IN_DIR) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .filter((dir) => {
      const pluginPath = path.join(dir, 'plugin.json');
      const toolPath = path.join(dir, 'tool-definition.json');
      if (!fs.existsSync(pluginPath) || !fs.existsSync(toolPath)) return false;
      const plugin = readJson(pluginPath);
      return !['runtime', 'figcode-card', 'figcode-data', 'content-plugin'].includes(plugin.type);
    });
}

export function validateHarnessManifests({ root = BUILT_IN_DIR } = {}) {
  const errors = [];
  const manifests = [];

  for (const dir of runnableBuiltInPluginDirs(root)) {
    const pluginPath = path.join(dir, 'plugin.json');
    const toolPath = path.join(dir, 'tool-definition.json');
    const plugin = readJson(pluginPath);
    const toolDefinition = readJson(toolPath);
    const manifest = pluginLoader.normalizePluginManifest(
      {
        ...plugin,
        pluginDir: dir,
        scriptPath: path.join(dir, 'scripts'),
      },
      toolDefinition,
    );
    const label = path.basename(dir);
    manifests.push(manifest);

    assertField(errors, manifest.pluginManifestVersion === 1, `${label}: pluginManifestVersion must be 1`);
    assertField(errors, manifest.id === plugin.id, `${label}: normalized id must match plugin.json id`);
    assertField(errors, manifest.id === toolDefinition.id, `${label}: plugin.json id must match tool-definition.json id`);
    assertField(errors, typeof manifest.title === 'string' && manifest.title.length > 0, `${label}: title is required`);
    assertField(errors, typeof manifest.version === 'string' && manifest.version.length > 0, `${label}: version is required`);
    assertField(errors, LANGUAGES.has(manifest.language), `${label}: language must be r or python`);
    assertField(errors, Array.isArray(manifest.supportedPlatforms) && manifest.supportedPlatforms.length > 0, `${label}: supportedPlatforms is required`);
    assertField(errors, Array.isArray(manifest.inputs) && manifest.inputs.length > 0, `${label}: inputs[] is required`);
    assertField(errors, Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0, `${label}: artifacts[] is required`);
    assertField(errors, Array.isArray(manifest.failureModes) && manifest.failureModes.length > 0, `${label}: failureModes[] is required`);
    assertUniqueKeys(errors, manifest.inputs, 'id', label, 'input');
    assertUniqueKeys(errors, manifest.artifacts, 'id', label, 'artifact');
    assertUniqueKeys(errors, manifest.failureModes, 'code', label, 'failure mode');

    for (const input of manifest.inputs) {
      assertField(errors, typeof input.id === 'string' && input.id.length > 0, `${label}: each input needs id`);
      assertField(errors, typeof input.type === 'string' && input.type.length > 0, `${label}.${input.id}: input type is required`);
      if (input.type === 'file') {
        assertField(errors, typeof input.accept === 'string' && input.accept.length > 0, `${label}.${input.id}: file input should declare accept`);
      }
    }

    for (const artifact of manifest.artifacts) {
      assertField(errors, typeof artifact.id === 'string' && artifact.id.length > 0, `${label}: each artifact needs id`);
      assertField(errors, ARTIFACT_TYPES.has(artifact.type), `${label}.${artifact.id}: unsupported artifact type ${artifact.type}`);
      assertField(errors, typeof artifact.label === 'string' && artifact.label.length > 0, `${label}.${artifact.id}: artifact label is required`);
    }

    for (const failureMode of manifest.failureModes) {
      assertField(errors, typeof failureMode.code === 'string' && failureMode.code.length > 0, `${label}: failure mode needs code`);
      assertField(errors, typeof failureMode.title === 'string' && failureMode.title.length > 0, `${label}.${failureMode.code}: failure mode title is required`);
      assertField(errors, typeof failureMode.suggestedFix === 'string' && failureMode.suggestedFix.length > 0, `${label}.${failureMode.code}: suggestedFix is required`);
      assertField(errors, typeof failureMode.detect === 'string' && failureMode.detect.length > 0, `${label}.${failureMode.code}: failure mode detect is required`);
    }
  }

  return { ok: errors.length === 0, errors, manifests };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = validateHarnessManifests();
  if (!result.ok) {
    console.error('[harness] manifest validation failed');
    for (const error of result.errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log(`[harness] validated ${result.manifests.length} runnable built-in plugin manifest(s)`);
  for (const manifest of result.manifests) {
    console.log(
      `- ${manifest.id} v${manifest.version}: ${manifest.inputs.length} input(s), ` +
        `${manifest.artifacts.length} artifact(s), ${manifest.failureModes.length} failure mode(s)`,
    );
  }
}
