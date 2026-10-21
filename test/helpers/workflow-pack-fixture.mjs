/**
 * BLOCK-234 — 测试用领域包夹具：提供 agentWorkflowTemplates。
 *
 * 工作流模板已从核心下沉 pack；核心测试不再依赖兄弟 petri-pack-bio 仓，
 * 用本夹具构造一个已安装、启用的最小 pack。调用后 PETRI_LOCAL_DATA_DIR
 * 指向临时数据目录，cleanup() 恢复原值并删除临时目录。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMPLATE_FIXTURE = path.join(ROOT, 'test', 'fixtures', 'agent-workflow-templates.json');

export function installWorkflowPackFixture() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-workflow-pack-'));
  const packRoot = path.join(dataDir, 'fixture-pack');
  fs.mkdirSync(path.join(dataDir, 'packs'), { recursive: true });
  fs.mkdirSync(packRoot, { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId: 'fixture-pack',
    provides: { agentWorkflowTemplates: 'workflow-templates.json' },
  }));
  fs.copyFileSync(TEMPLATE_FIXTURE, path.join(packRoot, 'workflow-templates.json'));
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
