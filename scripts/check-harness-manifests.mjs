#!/usr/bin/env node
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BUILT_IN_DIR = path.join(REPO_ROOT, 'resources', 'built-in-plugins');
const require = createRequire(import.meta.url);
const pluginLoader = require(path.join(REPO_ROOT, 'vendor', 'biof3-core', 'r-server', 'plugin-loader.js'));
const { inspectPluginSources } = require(path.join(REPO_ROOT, 'vendor', 'biof3-core', 'shared-backend', 'plugin-sdk.js'));

function defaultSources({ root, installedRoot, developmentRoots = [] } = {}) {
  const sources = [{ type: 'builtin', root: root || BUILT_IN_DIR, required: true }];
  if (installedRoot) sources.push({ type: 'installed', root: installedRoot });
  for (const developmentRoot of developmentRoots) {
    sources.push({ type: 'development', root: developmentRoot, required: true });
  }
  return sources;
}

export function validateHarnessManifests(options = {}) {
  const result = inspectPluginSources({
    sources: options.sources || defaultSources(options),
    normalizeManifest: pluginLoader.normalizePluginManifest,
  });
  return {
    ...result,
    errors: result.diagnostics
      .filter((item) => item.severity === 'error')
      .map((item) => `${item.pluginId || item.sourceType || 'plugin'}: ${item.message}`),
  };
}

function parseCli(argv) {
  const options = { developmentRoots: [], json: false };
  const rest = [...argv];
  while (rest.length) {
    const token = rest.shift();
    if (token === '--built-in') options.root = path.resolve(String(rest.shift() || ''));
    else if (token === '--installed') options.installedRoot = path.resolve(String(rest.shift() || ''));
    else if (token === '--development') options.developmentRoots.push(path.resolve(String(rest.shift() || '')));
    else if (token === '--json') options.json = true;
    else throw new Error(`Unknown option: ${token}`);
  }
  return options;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = parseCli(process.argv.slice(2));
    const result = validateHarnessManifests(options);
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`[harness] ${result.summary.validCount}/${result.summary.candidateCount} plugin manifest(s) valid`);
      for (const manifest of result.manifests) {
        console.log(`- ${manifest.id} v${manifest.version}: ${manifest.inputs.length} input(s), ${manifest.artifacts.length} artifact(s), ${manifest.failureModes.length} failure mode(s)`);
      }
      for (const item of result.diagnostics) {
        const output = item.severity === 'error' ? console.error : console.warn;
        output(`[${item.severity}] ${item.code} ${item.pluginId || item.sourceType || ''}: ${item.message}`);
      }
    }
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(`[harness] ${error.message}`);
    process.exitCode = 1;
  }
}
