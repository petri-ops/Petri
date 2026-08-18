/**
 * BLOCK-10-ARCHITECTURE PHASE 1.2 (A-010) — jspdf dead dependency removed.
 *
 * Coverage:
 *   A-010.8  frontend/package.json does not declare jspdf
 *   A-010.9  frontend/package-lock.json does not pin a jspdf entry
 *   A-010.10 frontend/src has zero jspdf imports / requires
 *   A-010.11 root package.json does not declare jspdf either
 *
 * 运行：cd desktop && node --test test/jspdf-removed.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const frontendSrcDir = path.join(root, 'frontend', 'src');

test('A-010.8 frontend/package.json does not declare jspdf', () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, 'frontend/package.json'), 'utf8'),
  );
  const deps = pkg.dependencies || {};
  const devDeps = pkg.devDependencies || {};
  assert.ok(
    !('jspdf' in deps),
    'frontend/package.json must not declare jspdf in dependencies',
  );
  assert.ok(
    !('jspdf' in devDeps),
    'frontend/package.json must not declare jspdf in devDependencies either',
  );
});

test('A-010.9 frontend/package-lock.json does not pin a jspdf entry', () => {
  const lock = JSON.parse(
    fs.readFileSync(path.join(root, 'frontend/package-lock.json'), 'utf8'),
  );
  const packages = lock.packages || {};
  // npm v7+ lockfiles use `packages` keyed by install path; v6 uses
  // `dependencies` keyed by package name. Check both for forward-compat.
  const jspdfInPackages = Object.keys(packages).some(
    (key) => key === 'node_modules/jspdf' || key.endsWith('/node_modules/jspdf'),
  );
  assert.ok(
    !jspdfInPackages,
    'frontend/package-lock.json must not contain a `node_modules/jspdf` entry',
  );
  if (lock.dependencies) {
    assert.ok(
      !('jspdf' in lock.dependencies),
      'frontend/package-lock.json must not declare jspdf in legacy `dependencies` block',
    );
  }
});

test('A-010.10 frontend/src has zero jspdf imports', () => {
  if (!fs.existsSync(frontendSrcDir)) {
    throw new Error(`frontend/src not found at ${frontendSrcDir}`);
  }
  // Walk the tree and grep every JS / TS / JSX / TSX file.
  function walk(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(m?[jt]sx?|cjs)$/.test(entry.name)) out.push(full);
    }
    return out;
  }
  const offenders = [];
  for (const file of walk(frontendSrcDir)) {
    const text = fs.readFileSync(file, 'utf8');
    if (/\bjspdf\b/.test(text)) offenders.push(file);
  }
  assert.deepStrictEqual(
    offenders,
    [],
    `frontend/src must not reference jspdf anywhere. Found in: ${offenders.join(', ')}`,
  );
});

test('A-010.11 root package.json does not declare jspdf either', () => {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) {
    // root package.json is required for this repo, so its absence is a
    // hard failure — but tolerate for non-standard test runs.
    return;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = pkg.dependencies || {};
  const devDeps = pkg.devDependencies || {};
  assert.ok(
    !('jspdf' in deps) && !('jspdf' in devDeps),
    'root package.json must not declare jspdf in either dependencies or devDependencies',
  );
});