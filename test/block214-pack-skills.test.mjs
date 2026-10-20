// ============================================================
// BLOCK-214 — Q-DOMAIN P1：领域包 Skills 贡献契约。
//
// 红绿先行：先钉住「pack 在位 → skill 出现（source=pack）；pack 卸载/停用/缺失 →
// skill 消失；核心 built-in 不再含 3 个生信 skill」。fixture pack + 临时 dataDir
// 驱动，不依赖真实 sibling pack。
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packRegistry = require('../core/shared-backend/pack-registry.js');
const skillRegistry = require('../core/shared-backend/skill-registry.js');

const BIO_SKILL_IDS = ['deg-analysis-standard', 'go-enrichment-analysis', 'sc-analysis-standard'];

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'block214-pack-skills-'));
}

function makeFixturePack(root, { packId = 'p_skills', withSkills = true } = {}) {
  const packRoot = path.join(root, 'pack');
  fs.mkdirSync(path.join(packRoot, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({ packId, name: packId, version: '0.1.0', provides: { skills: 'skills/' } }));
  fs.writeFileSync(path.join(packRoot, 'plugins', 'installed.json'), '[]');
  if (withSkills) {
    const skillDir = path.join(packRoot, 'skills', 'fixture-skill');
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(packRoot, 'skills', 'manifest.json'), JSON.stringify({
      manifestVersion: 1,
      source: 'pack',
      skills: { 'fixture-skill': { id: 'fixture-skill', version: '1.0.0' } },
    }));
    fs.writeFileSync(path.join(skillDir, 'skill.json'), JSON.stringify({
      skillManifestVersion: 1,
      id: 'fixture-skill',
      name: 'Fixture Skill',
      version: '1.0.0',
      description: 'fixture skill from a domain pack',
      category: 'fixture/domain',
      plugins: { required: [], optional: [] },
    }));
    fs.writeFileSync(path.join(skillDir, 'README.md'), '# Fixture Skill\n');
  }
  return packRoot;
}

function withEnv(dataDir, fn) {
  const prevData = process.env.PETRI_LOCAL_DATA_DIR;
  const prevUser = process.env.PETRI_USER_DATA_DIR;
  process.env.PETRI_LOCAL_DATA_DIR = dataDir;
  process.env.PETRI_USER_DATA_DIR = path.join(dataDir, 'user-state');
  try {
    return fn();
  } finally {
    if (prevData === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = prevData;
    if (prevUser === undefined) delete process.env.PETRI_USER_DATA_DIR;
    else process.env.PETRI_USER_DATA_DIR = prevUser;
  }
}

function installFixture(dataDir, packRoot, extra = {}) {
  packRegistry.writeInstalledPacks(dataDir, [{
    packId: 'p_skills',
    packRoot,
    version: '0.1.0',
    requiresRuntimes: [],
    installedAt: '2026-10-20T00:00:00Z',
    ...extra,
  }]);
}

function discoverIds() {
  return skillRegistry.discoverSkills().map((skill) => ({ id: skill.id, source: skill.source }));
}

test('BLOCK-214 pack skills: 已安装 pack → skill 以 source=pack 出现', () => {
  const root = tempRoot();
  const dataDir = path.join(root, 'data');
  const packRoot = makeFixturePack(root);
  installFixture(dataDir, packRoot);

  const found = withEnv(dataDir, () => discoverIds()).find((skill) => skill.id === 'fixture-skill');
  assert.deepEqual(found, { id: 'fixture-skill', source: 'pack' });
});

test('BLOCK-214 pack skills: 卸载 pack → skill 从 registry 消失（残留清理）', () => {
  const root = tempRoot();
  const dataDir = path.join(root, 'data');
  const packRoot = makeFixturePack(root);
  installFixture(dataDir, packRoot);

  withEnv(dataDir, () => {
    assert.ok(discoverIds().some((skill) => skill.id === 'fixture-skill'));
    packRegistry.writeInstalledPacks(dataDir, []);
    assert.ok(!discoverIds().some((skill) => skill.id === 'fixture-skill'));
  });
});

test('BLOCK-214 pack skills: pack 停用（enabled=false）→ skill 不出现', () => {
  const root = tempRoot();
  const dataDir = path.join(root, 'data');
  const packRoot = makeFixturePack(root);
  installFixture(dataDir, packRoot, { enabled: false });

  withEnv(dataDir, () => {
    assert.ok(!discoverIds().some((skill) => skill.id === 'fixture-skill'));
  });
});

test('BLOCK-214 pack skills: pack 缺失/无 skills 目录 → 不报错、无 pack skill', () => {
  const root = tempRoot();
  const dataDir = path.join(root, 'data');
  const packRoot = makeFixturePack(root, { withSkills: false });
  installFixture(dataDir, packRoot);

  withEnv(dataDir, () => {
    const ids = discoverIds();
    assert.ok(!ids.some((skill) => skill.id === 'fixture-skill'));
    assert.equal(skillRegistry.loadPackSkills().length, 0);
  });
});

test('BLOCK-214 pack skills: 核心 built-in 不再包含 3 个生信 skill', () => {
  const builtInIds = skillRegistry.loadBuiltInSkills().map((skill) => skill.id);
  for (const id of BIO_SKILL_IDS) {
    assert.ok(!builtInIds.includes(id), `built-in 仍包含 ${id}`);
  }
});
