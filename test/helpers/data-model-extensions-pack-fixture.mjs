/**
 * BLOCK-235 — fixture pack for dataModelExtensions.
 * Installs a pack declaring one extension profile and its actors before the
 * SDC-0 registry is imported.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export function installDataModelExtensionsPackFixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b235-datamodel-'));
  const packRoot = path.join(dataDir, 'fixture-pack');
  fs.mkdirSync(path.join(dataDir, 'packs'), { recursive: true });
  fs.mkdirSync(packRoot, { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId: 'fixture-pack',
    provides: {
      dataModelExtensions: 'data-model-extensions.json',
      artifactProfileActors: 'artifact-profile-actors.json',
    },
  }));
  fs.copyFileSync(
    path.join(ROOT, 'test/fixtures/data-model-extension.json'),
    path.join(packRoot, 'data-model-extensions.json'),
  );
  fs.writeFileSync(path.join(packRoot, 'artifact-profile-actors.json'), JSON.stringify({
    'petri.custom-table.v1': {
      producers: ['fixture-producer'],
      consumers: ['fixture-consumer'],
    },
  }));
  fs.writeFileSync(path.join(dataDir, 'packs', 'installed.json'), JSON.stringify([
    { packId: 'fixture-pack', packRoot, enabled: true },
  ]));
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
