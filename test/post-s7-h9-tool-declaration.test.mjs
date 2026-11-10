/**
 * B-20 结构化能力声明契约（红绿先行）。
 * 钉住：解析后按字段命中；注释里的工具名、裸字符串、空值都不算声明。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { findToolDeclarations } from '../scripts/post-s7-tool-declaration.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('现场：顶层 manifest + 兄弟仓 registry 结构化解析，goldenPath.tool 有真实声明', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'release-contract.json'), 'utf8'));
  const toolId = contract.goldenPath.tool;
  const skillsManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'resources/skills/manifest.json'), 'utf8'));
  const packPath = path.join(ROOT, '..', 'petri-pack-bio', 'registry', 'tool-registry.json');
  const packRegistry = fs.existsSync(packPath) ? JSON.parse(fs.readFileSync(packPath, 'utf8')) : {};
  const r = findToolDeclarations(toolId, { skillsManifest, packRegistry });
  assert.equal(r.ok, true, JSON.stringify(r.hits));
  assert.ok(r.hits.includes('pack:TOOLS'), 'deseq2 由领域包 TOOLS 键真实声明');
});

test('负测：注释提及 / 字符串提及 / 空对象都不能算声明', () => {
  const commentOnly = { skills: { fake: { capabilities: [], description: 'this mentions deseq2 in a comment' } } };
  assert.equal(findToolDeclarations('deseq2', { skillsManifest: commentOnly }).ok, false);
  assert.equal(findToolDeclarations('deseq2', { packRegistry: { TOOLS: { deseq2: null } } }).ok, false);
  assert.equal(findToolDeclarations('deseq2', { packRegistry: { TOOLS: {} }, skillsManifest: {} }).ok, false);
  assert.equal(findToolDeclarations('', { skillsManifest: {} }).ok, false);
});

test('正测：capabilities 显式列出 / skill id 同名 / TOOLS 真实对象都算', () => {
  assert.deepEqual(findToolDeclarations('x', { skillsManifest: { skills: { s: { capabilities: ['x'] } } } }).hits, ['skills:s']);
  assert.deepEqual(findToolDeclarations('x', { skillsManifest: { skills: { x: { capabilities: [] } } } }).hits, ['skills:x']);
  assert.deepEqual(findToolDeclarations('x', { packRegistry: { TOOLS: { x: { lang: 'r' } } } }).hits, ['pack:TOOLS']);
});
