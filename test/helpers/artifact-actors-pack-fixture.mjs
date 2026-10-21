/**
 * BLOCK-234 — 测试用领域包夹具：提供 artifactProfileActors。
 * 调用后 PETRI_LOCAL_DATA_DIR 指向临时数据目录；cleanup() 恢复并删除。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ACTORS_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'artifact-profile-actors.json');

export function installArtifactActorsPackFixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-artifact-actors-'));
  const packRoot = path.join(dataDir, 'fixture-pack');
  fs.mkdirSync(path.join(dataDir, 'packs'), { recursive: true });
  fs.mkdirSync(packRoot, { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId: 'fixture-pack',
    provides: { artifactProfileActors: 'artifact-profile-actors.json' },
  }));
  fs.copyFileSync(ACTORS_FIXTURE, path.join(packRoot, 'artifact-profile-actors.json'));
  fs.writeFileSync(
    path.join(dataDir, 'packs', 'installed.json'),
    JSON.stringify([{ packId: 'fixture-pack', packRoot, enabled: true, version: '1.0.0' }]),
  );
  const previous = process.env.PETRI_LOCAL_DATA_DIR;
  process.env.PETRI_LOCAL_DATA_DIR = dataDir;
  return {
    dataDir,
    packRoot,
    cleanup() {
      if (previous === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
      else process.env.PETRI_LOCAL_DATA_DIR = previous;
      try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {}
    },
  };
}
