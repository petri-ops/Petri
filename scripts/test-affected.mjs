#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = JSON.parse(readFileSync(resolve(ROOT, 'test/impact-map.json'), 'utf8'));
const COMMANDS = {
  'docs-check': ['npm', ['run', 'docs:check']],
  'ui-audit': ['npm', ['run', 'ui:audit:check']],
  'harness-check': ['npm', ['run', 'harness:check']],
  'frontend-check': ['npm', ['--prefix', 'frontend', 'run', 'check']],
  'frontend-all': ['npm', ['--prefix', 'frontend', 'run', 'test:all']],
};
const COMMAND_ORDER = ['docs-check', 'ui-audit', 'harness-check', 'frontend-check', 'frontend-all'];

function escapeRegExp(value) { return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }

export function globMatches(pattern, value) {
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') { source += '.*'; i += 1; }
    else if (pattern[i] === '*') source += '[^/]*';
    else source += escapeRegExp(pattern[i]);
  }
  return new RegExp(`${source}$`).test(value);
}

function normalizePath(value) { return value.replaceAll('\\', '/').replace(/^\.\//, ''); }

function runGit(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/).map((line) => normalizePath(line.trim())).filter(Boolean);
}

function listScripts() {
  return execFileSync('rg', ['--files', 'scripts'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/).map((line) => normalizePath(line.trim())).filter((file) => /\.(?:js|mjs|cjs|sh)$/.test(file));
}

function validateMap(map) {
  if (map.schema !== 'biof3/test-impact-map.v1' || !Array.isArray(map.rules)) throw new Error('invalid test impact map schema');
  const commandIds = new Set(Object.keys(COMMANDS));
  const scriptRules = [];
  for (const rule of map.rules) {
    if (!rule.id || !Array.isArray(rule.patterns) || !rule.patterns.length) throw new Error(`invalid impact rule: ${rule.id || '<missing>'}`);
    for (const command of rule.commands || []) if (!commandIds.has(command)) throw new Error(`${rule.id} references unknown command ${command}`);
    for (const test of rule.tests || []) if (!existsSync(resolve(ROOT, test))) throw new Error(`${rule.id} references missing test ${test}`);
    if (rule.classifiesScripts) scriptRules.push(rule);
  }
  const uncovered = listScripts().filter((file) => scriptRules.filter((rule) => rule.patterns.some((pattern) => globMatches(pattern, file))).length !== 1);
  if (uncovered.length) throw new Error(`script classification must match exactly one rule: ${uncovered.join(', ')}`);
}

export function collectChangedFiles({ base = null, explicit = [] } = {}) {
  if (explicit.length) return [...new Set(explicit.map(normalizePath))].sort();
  const files = new Set();
  if (base) runGit(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`]).forEach((file) => files.add(file));
  runGit(['diff', '--name-only', '--diff-filter=ACMR']).forEach((file) => files.add(file));
  runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).forEach((file) => files.add(file));
  runGit(['ls-files', '--others', '--exclude-standard']).forEach((file) => files.add(file));
  return [...files].sort();
}

function isNodeSource(file) { return /\.(?:js|mjs|cjs)$/.test(file) && !file.startsWith('test/') && !file.startsWith('frontend/'); }

export function resolveImpact(changedFiles, map = MAP) {
  validateMap(map);
  const tests = new Set(); const commands = new Set(); const frontendRelated = new Set(); const syntax = new Set(); const unknown = []; const reasons = new Map();
  for (const file of changedFiles.map(normalizePath)) {
    let matched = false;
    for (const rule of map.rules) {
      if (!rule.patterns.some((pattern) => globMatches(pattern, file))) continue;
      matched = true;
      for (const test of rule.tests || []) tests.add(test);
      for (const command of rule.commands || []) commands.add(command);
      if (rule.frontendRelated) frontendRelated.add(file.replace(/^frontend\//, ''));
      reasons.set(file, [...(reasons.get(file) || []), rule.id]);
    }
    if (/^frontend\/src\//.test(file)) frontendRelated.add(file.replace(/^frontend\//, ''));
    if (isNodeSource(file)) syntax.add(file);
    if (/^test\/.*\.test\.(?:mjs|cjs|js)$/.test(file)) tests.add(file);
    if (!matched && !/^dist\//.test(file) && !/^release\//.test(file)) unknown.push(file);
  }
  return { changedFiles: [...new Set(changedFiles.map(normalizePath))].sort(), tests: [...tests].sort(), commands: COMMAND_ORDER.filter((command) => commands.has(command)), frontendRelated: [...frontendRelated].sort(), syntax: [...syntax].sort(), unknown: [...new Set(unknown)].sort(), reasons: Object.fromEntries([...reasons].map(([file, rules]) => [file, [...new Set(rules)]])) };
}

function parseArgs(argv) {
  const explicit = argv.find((arg) => arg.startsWith('--files='));
  return { run: argv.includes('--run'), json: argv.includes('--json'), base: argv.find((arg) => arg.startsWith('--base='))?.slice(7) || null, explicit: explicit ? explicit.slice(8).split(',').filter(Boolean) : [] };
}

function printPlan(plan, json) {
  if (json) { console.log(JSON.stringify(plan, null, 2)); return; }
  console.log(`[test:changed] changed=${plan.changedFiles.length} nodeTests=${plan.tests.length} syntax=${plan.syntax.length}`);
  plan.tests.forEach((file) => console.log(`  test ${file}`));
  plan.frontendRelated.forEach((file) => console.log(`  frontend-related ${file}`));
  if (plan.commands.length) console.log(`  gates ${plan.commands.join(', ')}`);
  if (plan.unknown.length) console.error(`  unmapped ${plan.unknown.join(', ')}`);
}

function runProcess(command, args) { return spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' }).status ?? 1; }

export function runPlan(plan) {
  if (plan.unknown.length) return 2;
  for (const file of plan.syntax) { const status = runProcess(process.execPath, ['--check', file]); if (status !== 0) return status; }
  if (plan.tests.length) { const status = runProcess(process.execPath, ['--test', ...plan.tests]); if (status !== 0) return status; }
  if (plan.frontendRelated.length) { const status = runProcess('npm', ['--prefix', 'frontend', 'run', 'test:related', '--', ...plan.frontendRelated, '--passWithNoTests']); if (status !== 0) return status; }
  if (plan.commands.includes('frontend-all')) { const status = runProcess(...COMMANDS['frontend-all']); if (status !== 0) return status; }
  for (const command of plan.commands.filter((item) => item !== 'frontend-all')) { const status = runProcess(...COMMANDS[command]); if (status !== 0) return status; }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try { const args = parseArgs(process.argv.slice(2)); const plan = resolveImpact(collectChangedFiles({ base: args.base, explicit: args.explicit })); printPlan(plan, args.json); process.exitCode = args.run ? runPlan(plan) : (plan.unknown.length ? 2 : 0); }
  catch (error) { console.error(`[test:changed] ${error.message}`); process.exitCode = 2; }
}
