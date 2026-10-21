/**
 * BLOCK-233 — Q-DOMAIN P4-C S1：tool 元数据单一源。
 *
 * 钉住：显示名 / 严格 CSV 校验集合 / 一列基因表规则 / 上传大小上限
 * 全部由领域包注册表声明驱动，核心不再内联第二份工具清单。
 * 夹具注册表保证测试不依赖兄弟 pack 仓。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b233-registry-'));
const fixtureFile = path.join(fixtureDir, 'tool-registry.json');
fs.writeFileSync(fixtureFile, JSON.stringify({
  TOOLS: {
    'go-kegg': {
      displayName: 'GO/KEGG ORA',
      csvInputs: ['genes'],
      csvValidation: true,
      acceptsSingleColumnGeneList: true,
      sizeLimitMB: 100,
    },
    gsea: {
      displayName: 'GSEA',
      csvInputs: ['ranked_list'],
      csvValidation: true,
      sizeLimitMB: 100,
    },
    'seurat-standard': {
      displayName: 'Seurat',
      csvInputs: ['matrix'],
      sizeLimitMB: 500,
    },
    'maftools-mutation': {
      displayName: 'maftools',
      csvInputs: ['clinical'],
      sizeLimitMB: 200,
    },
    'limited-tool': {
      displayName: 'Limited',
      csvInputs: ['x'],
      sizeLimitMB: 1,
    },
    'custom-strict': {
      displayName: '自定义严格工具',
      csvInputs: ['genes'],
      csvValidation: true,
      sizeLimitMB: 100,
    },
  },
}));
process.env.PETRI_DOMAIN_TOOL_REGISTRY = fixtureFile;

const registry = require(path.join(ROOT, 'core/petri-server/tool-registry.js'));
const { validateUploadedFiles } = require(path.join(ROOT, 'core/petri-server/helpers/tools-executor/result-files.js'));

const jobDirs = [];
function jobWithFile(name, content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b233-job-'));
  fs.writeFileSync(path.join(dir, name), content);
  jobDirs.push(dir);
  return dir;
}
function fileMap(name, content) {
  return { [name]: Buffer.from(content).toString('base64') };
}

after(() => {
  try { fs.rmSync(fixtureDir, { recursive: true, force: true }); } catch {}
  for (const dir of jobDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

test('显示名来自注册表；未知工具回落 id', () => {
  assert.equal(registry.getToolDisplayName('custom-strict'), '自定义严格工具');
  assert.equal(registry.getToolDisplayName('go-kegg'), 'GO/KEGG ORA');
  assert.equal(registry.getToolDisplayName('not-installed'), 'not-installed');
});

test('严格 CSV 校验集合来自声明，而不是 csvInputs 的存在性', () => {
  assert.deepEqual(
    registry.listCsvValidationToolIds().sort(),
    ['custom-strict', 'go-kegg', 'gsea'],
    'seurat/maftools/limited-tool 有 csvInputs 但未声明 csvValidation，不得进入严格集合',
  );
});

test('一列基因表规则来自声明', () => {
  assert.equal(registry.toolAcceptsSingleColumnGeneList('go-kegg'), true);
  assert.equal(registry.toolAcceptsSingleColumnGeneList('gsea'), false);
  assert.equal(registry.toolAcceptsSingleColumnGeneList('not-installed'), false);
});

test('上传大小上限读注册表声明', () => {
  assert.equal(registry.getToolSizeLimitMB('seurat-standard'), 500);
  assert.equal(registry.getToolSizeLimitMB('maftools-mutation'), 200);
  assert.equal(registry.getToolSizeLimitMB('limited-tool'), 1);
  assert.equal(registry.getToolSizeLimitMB('not-installed'), 100);
});

test('声明了 csvValidation 的工具才做严格列校验（自定义工具可被数据驱动）', () => {
  const dir = jobWithFile('genes.csv', 'gene\nTP53\n');
  const error = validateUploadedFiles('custom-strict', dir, fileMap('genes.csv', 'gene\nTP53\n'));
  assert.match(error, /只检测到 1 列/);
});

test('go-kegg 一列表放行、gsea 一列表拒绝（旧行为保持）', () => {
  const oneCol = 'gene\nTP53\n';
  const kDir = jobWithFile('genes.csv', oneCol);
  assert.equal(validateUploadedFiles('go-kegg', kDir, fileMap('genes.csv', oneCol)), null);
  const gDir = jobWithFile('ranked.csv', oneCol);
  assert.match(validateUploadedFiles('gsea', gDir, fileMap('ranked.csv', oneCol)), /只检测到 1 列/);
});

test('未声明严格校验的工具不做 CSV 列校验（旧行为保持）', () => {
  const oneCol = 'gene\nTP53\n';
  const dir = jobWithFile('matrix.csv', oneCol);
  assert.equal(validateUploadedFiles('seurat-standard', dir, fileMap('matrix.csv', oneCol)), null);
});

test('二进制内容在严格 CSV 工具上仍被拒绝', () => {
  const binary = 'a\u0000b,c\n1,2\n';
  const dir = jobWithFile('bad.csv', binary);
  assert.match(validateUploadedFiles('custom-strict', dir, fileMap('bad.csv', binary)), /二进制文件/);
});

test('大小上限按注册表声明生效（1MB 夹具）', () => {
  const big = 'x'.repeat(1024 * 1024 + 1024);
  const dir = jobWithFile('big.txt', big);
  const error = validateUploadedFiles('limited-tool', dir, fileMap('big.txt', big));
  assert.match(error, /超过推荐上限\(1MB\)/);
});
