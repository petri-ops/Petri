'use strict';

/**
 * BLOCK-215 — 已安装领域包贡献的 prompt fragments。
 *
 * 领域指令（如生信工具 ID、单细胞 UI 动作）不再硬编码进核心 prompt：
 * pack 在 `<packRoot>/promptFragments/` 提供 markdown，核心只在 pack 已安装/启用时
 * 读取并追加到 system prompt。包缺失/停用 → 不注入任何领域指令。
 * 读取失败 fail-open 为空（不阻断主循环），但不会把未安装的包当已安装。
 */

const fs = require('fs');
const path = require('path');
const packRegistry = require('../../shared-backend/pack-registry');
const { resolveDataDir } = require('../../shared-backend/data-paths');

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadPackPromptFragments() {
  let packs = [];
  try {
    packs = packRegistry.readInstalledPacks(resolveDataDir());
  } catch {
    return [];
  }
  const fragments = [];
  for (const pack of packs) {
    if (!pack || pack.enabled === false || !pack.packRoot) continue;
    const root = path.join(pack.packRoot, 'promptFragments');
    if (!fs.existsSync(root)) continue;
    const manifest = readJson(path.join(root, 'manifest.json'));
    const files = manifest && Array.isArray(manifest.files)
      ? manifest.files
      : fs.readdirSync(root).filter((file) => file.endsWith('.md')).sort();
    for (const file of files) {
      if (typeof file !== 'string' || !file.endsWith('.md')) continue;
      const full = path.join(root, file);
      if (!fs.existsSync(full)) continue;
      const content = fs.readFileSync(full, 'utf8').trim();
      if (content) fragments.push({ packId: pack.packId, name: file, content });
    }
  }
  return fragments;
}

function renderPackPromptFragments() {
  const fragments = loadPackPromptFragments();
  if (fragments.length === 0) return '';
  return fragments
    .map((fragment) => `<!-- pack:${fragment.packId}/${fragment.name} -->\n${fragment.content}`)
    .join('\n\n');
}

module.exports = {
  loadPackPromptFragments,
  renderPackPromptFragments,
};
