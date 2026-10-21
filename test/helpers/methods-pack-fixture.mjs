/**
 * BLOCK-234 — 测试用领域包夹具：提供 methods.pythonEquivalents / reportCitations。
 * 调用后 PETRI_LOCAL_DATA_DIR 指向临时数据目录；cleanup() 恢复并删除。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const METHODS_FIXTURES = path.join(ROOT, 'test', 'fixtures', 'methods');

export function installMethodsPackFixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-methods-pack-'));
  const packRoot = path.join(dataDir, 'fixture-pack');
  fs.mkdirSync(path.join(dataDir, 'packs'), { recursive: true });
  fs.mkdirSync(packRoot, { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId: 'fixture-pack',
    provides: {
      methods: {
        pythonEquivalents: 'methods/python-equivalents.json',
        reportCitations: 'methods/report-citations.json',
      },
    },
  }));
  fs.mkdirSync(path.join(packRoot, 'methods'), { recursive: true });
  fs.copyFileSync(
    path.join(METHODS_FIXTURES, 'python-equivalents.json'),
    path.join(packRoot, 'methods', 'python-equivalents.json'),
  );
  fs.copyFileSync(
    path.join(METHODS_FIXTURES, 'report-citations.json'),
    path.join(packRoot, 'methods', 'report-citations.json'),
  );
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
