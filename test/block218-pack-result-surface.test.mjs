// ============================================================
// BLOCK-218 — 生信 pack 的 resultSurface 契约（静态契约 + 页面能力断言）。
// 外部 pack 仓缺失时 skip（fail-closed：不把缺失当通过）；pack 在位时钉住
// resultSurfaces/modes/entry 与页面只消费 host context、不联网、不写真相。
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  process.env.PETRI_BIO_PACK_ROOT,
  path.resolve(root, '..', 'petri-pack-bio'),
].filter(Boolean);

function findPack() {
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'pack.json'))) return dir;
  }
  return null;
}

const packRoot = findPack();

test('BLOCK-218 pack resultSurface: declared as a result-mode surface with a real entry', { skip: packRoot ? false : 'petri-pack-bio not checked out' }, () => {
  const pack = JSON.parse(fs.readFileSync(path.join(packRoot, 'pack.json'), 'utf8'));
  const surfaces = pack.provides && pack.provides.resultSurfaces;
  assert.ok(Array.isArray(surfaces), 'provides.resultSurfaces must be an array');
  const bio = surfaces.find((surface) => surface && surface.id === 'bio-result');
  assert.ok(bio, 'bio-result surface missing');
  assert.deepEqual(bio.modes, ['result'], 'P2b slice owns result mode only');
  assert.ok(bio.artifactTypes.includes('plot'));
  assert.ok(bio.artifactTypes.includes('table'));
  assert.ok(bio.artifactTypes.includes('report'));
  assert.equal(fs.existsSync(path.join(packRoot, bio.entry)), true, 'entry must exist inside the pack');
});

test('BLOCK-218 pack result page: consumes host context and never reaches the network', { skip: packRoot ? false : 'petri-pack-bio not checked out' }, () => {
  const html = fs.readFileSync(path.join(packRoot, 'ui', 'result.html'), 'utf8');
  assert.match(html, /petri:surface-context/);
  assert.match(html, /resultData/);
  assert.match(html, /imageDataUrl/);
  assert.match(html, /data\.rows/);
  assert.match(html, /data\.text/);
  assert.match(html, /petri:ready/);
  assert.doesNotMatch(html, /https?:\/\//, 'pack result page must not reference external URLs');
  assert.doesNotMatch(html, /fetch\(/, 'pack result page must not fetch data itself');
});
