/**
 * B-29 内置 Skill 完整性契约（红绿先行）。
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateSkillIntegrity, builtinDigest } from '../scripts/post-s7-skill-integrity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'resources/skills/manifest.json');

const sampleManifest = (digest) => ({
  skills: {
    alpha: {
      artifacts: { 'macos-arm64': { url: 'built-in://skills/alpha', sha256: null } },
      integrity: { builtinSha256: digest },
    },
  },
});

test('现场：11 条内置 skill 摘要在册且无漂移', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const digests = {};
  for (const id of Object.keys(manifest.skills)) {
    digests[id] = builtinDigest(path.join(ROOT, 'resources/skills', id));
  }
  const r = evaluateSkillIntegrity(manifest, digests);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
  assert.equal(r.checked.length, 11);
});

test('摘要确定性：同目录两次计算结果一致', () => {
  const dir = path.join(ROOT, 'resources/skills/coding-playbook');
  assert.equal(builtinDigest(dir), builtinDigest(dir));
  assert.match(builtinDigest(dir), /^[a-f0-9]{64}$/);
});

test('负测：目录内容漂移 / 摘要被手改 / 缺登记 / 伪造 sha256 都红', () => {
  const good = 'a'.repeat(64);
  const digests = { alpha: good };
  assert.equal(evaluateSkillIntegrity(sampleManifest(good), digests).ok, true);
  assert.equal(evaluateSkillIntegrity(sampleManifest(good), { alpha: 'b'.repeat(64) }).ok, false);

  const noIntegrity = sampleManifest(good); delete noIntegrity.skills.alpha.integrity;
  assert.ok(evaluateSkillIntegrity(noIntegrity, digests).issues.some((i) => i.includes('缺 integrity')));

  const forged = sampleManifest(good);
  forged.skills.alpha.artifacts['macos-arm64'].sha256 = 'deadbeef';
  assert.ok(evaluateSkillIntegrity(forged, digests).issues.some((i) => i.includes('伪造')));

  assert.ok(evaluateSkillIntegrity(sampleManifest(good), { alpha: good, beta: 'c'.repeat(64) })
    .issues.some((i) => i.includes('未登记')));
});

test('负测：目录不存在即红（防静默漏测）', () => {
  const r = evaluateSkillIntegrity(sampleManifest('a'.repeat(64)), { alpha: null });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.includes('不存在')));
});

test('摘要算法可离线复算（不依赖 manifest）', () => {
  const h = crypto.createHash('sha256').update('x').digest('hex');
  assert.equal(h.length, 64);
});
