// ============================================================
// BLOCK-215 — Q-DOMAIN P2a：领域 prompt fragments 契约。
//
// 钉住：①已安装/启用 pack 的 promptFragments 被加载并渲染；②pack 缺失/停用
// → 零注入；③核心 prompt 源文件不再硬编码生信指令（领域指令只在 pack）。
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packRegistry = require(path.join(ROOT, 'core/shared-backend/pack-registry.js'));
const promptFragments = require(path.join(ROOT, 'core/petri-server/helpers/pack-prompt-fragments.js'));

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'block215-prompt-fragments-'));
}

function makeFixturePack(root, { packId = 'p_prompt', withFragment = true } = {}) {
  const packRoot = path.join(root, 'pack');
  fs.mkdirSync(path.join(packRoot, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId,
    name: packId,
    version: '0.1.0',
    provides: { promptFragments: 'promptFragments/' },
  }));
  fs.writeFileSync(path.join(packRoot, 'plugins', 'installed.json'), '[]');
  if (withFragment) {
    fs.mkdirSync(path.join(packRoot, 'promptFragments'), { recursive: true });
    fs.writeFileSync(path.join(packRoot, 'promptFragments', 'domain.md'), '## Fixture Domain\n- 领域指令只在 pack 内。\n');
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

function install(dataDir, packRoot, extra = {}) {
  packRegistry.writeInstalledPacks(dataDir, [{
    packId: 'p_prompt',
    packRoot,
    version: '0.1.0',
    requiresRuntimes: [],
    installedAt: '2026-10-20T00:00:00Z',
    ...extra,
  }]);
}

test('BLOCK-215 prompt fragments: 已安装 pack → 渲染 fragment', () => {
  const root = tempRoot();
  const dataDir = path.join(root, 'data');
  const packRoot = makeFixturePack(root);
  install(dataDir, packRoot);

  const text = withEnv(dataDir, () => promptFragments.renderPackPromptFragments());
  assert.match(text, /Fixture Domain/);
  assert.match(text, /领域指令只在 pack 内/);
  assert.match(text, /pack:p_prompt\/domain\.md/);
});

test('BLOCK-215 prompt fragments: pack 缺失/停用 → 零注入', () => {
  const root = tempRoot();
  const dataDir = path.join(root, 'data');
  const packRoot = makeFixturePack(root, { withFragment: false });
  install(dataDir, packRoot);
  assert.equal(withEnv(dataDir, () => promptFragments.renderPackPromptFragments()), '');

  const disabledData = path.join(root, 'disabled-data');
  const disabledPack = makeFixturePack(path.join(root, 'disabled'), { packId: 'p_disabled' });
  install(disabledData, disabledPack, { packId: 'p_disabled', enabled: false });
  assert.equal(withEnv(disabledData, () => promptFragments.renderPackPromptFragments()), '');
});

test('BLOCK-215 prompt fragments: 核心 prompt 不再硬编码生信指令', () => {
  const agentRunner = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-runner.js'), 'utf8');
  const systemPrompt = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/system-prompt.js'), 'utf8');
  for (const phrase of ['DESeq2', '单细胞 UI 控制工具', 'seurat-standard', '火山图', 'GO/KEGG', 'GSEA']) {
    assert.ok(!agentRunner.includes(phrase), `agent-runner 仍含领域短语: ${phrase}`);
    assert.ok(!systemPrompt.includes(phrase), `system-prompt 仍含领域短语: ${phrase}`);
  }
});
