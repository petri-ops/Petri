'use strict';

/**
 * pack-registry.js — 领域包安装注册表（BLOCK-84：产品级一键装/卸）
 *
 * 职责：领域包的发现（available）、安装记录（installed record）、校验与卸载。
 * 安装记录 = `<dataDir>/packs/installed.json`（数组），与插件 installed.json 先例同构。
 * 本模块只管记录与校验；boot 接线（插件源追加 + tool-registry 注册）由 server 启动时消费记录完成。
 *
 * 包契约（pack.json）：packId 必填；plugins/installed.json 必须存在（可装载性硬证据）。
 */

const fs = require('fs');
const path = require('path');

function packsRecordFile(dataDir) {
  return path.join(dataDir, 'packs', 'installed.json');
}

function readInstalledPacks(dataDir) {
  const file = packsRecordFile(dataDir);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && item.packId && item.packRoot);
  } catch {
    return [];
  }
}

function writeInstalledPacks(dataDir, packs) {
  const file = packsRecordFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(packs, null, 2) + '\n', 'utf-8');
}

/** 校验一个包目录：pack.json 契约 + 可装载性硬证据。返回 { ok, pack?, error? }。 */
function validatePackDir(packRoot) {
  const packJsonPath = path.join(packRoot, 'pack.json');
  if (!fs.existsSync(packJsonPath)) {
    return { ok: false, error: 'pack_json_missing' };
  }
  let pack;
  try {
    pack = JSON.parse(fs.readFileSync(packJsonPath, 'utf-8'));
  } catch (error) {
    return { ok: false, error: 'pack_json_invalid:' + error.message };
  }
  if (!pack || typeof pack.packId !== 'string' || !pack.packId.trim()) {
    return { ok: false, error: 'pack_id_missing' };
  }
  if (!fs.existsSync(path.join(packRoot, 'plugins', 'installed.json'))) {
    return { ok: false, error: 'pack_plugins_index_missing' };
  }
  return {
    ok: true,
    pack: {
      packId: pack.packId,
      name: pack.name || pack.packId,
      nameEn: pack.nameEn || null,
      version: pack.version || '0.0.0',
      description: pack.description || '',
      provides: pack.provides || {},
      packRoot: path.resolve(packRoot),
    },
  };
}

/** 发现可用包：兄弟仓 gewu-pack-bio（dev 便利）+ 调用方给定的候选目录。 */
function discoverAvailablePacks({ projectRoot, extraDirs = [] } = {}) {
  const candidates = [];
  if (projectRoot) {
    candidates.push(path.resolve(projectRoot, '..', 'gewu-pack-bio'));
  }
  for (const dir of extraDirs) candidates.push(path.resolve(dir));
  const seen = new Set();
  const available = [];
  for (const dir of candidates) {
    if (seen.has(dir) || !fs.existsSync(dir)) continue;
    seen.add(dir);
    const validated = validatePackDir(dir);
    if (validated.ok) available.push(validated.pack);
  }
  return available;
}

/** 安装（幂等）：校验 → 记录 upsert。返回 { ok, pack, installed } 或 { ok:false, error }。 */
function installPack(dataDir, packRoot) {
  const validated = validatePackDir(packRoot);
  if (!validated.ok) return validated;
  const packs = readInstalledPacks(dataDir);
  const existing = packs.findIndex((p) => p.packId === validated.pack.packId);
  const record = {
    packId: validated.pack.packId,
    packRoot: validated.pack.packRoot,
    version: validated.pack.version,
    installedAt: new Date().toISOString(),
  };
  if (existing >= 0) packs[existing] = record;
  else packs.push(record);
  writeInstalledPacks(dataDir, packs);
  return { ok: true, pack: validated.pack, installed: true, updated: existing >= 0 };
}

/** 卸载：移除安装记录（包文件本身不动——用户资产）。返回 { ok, removed } 或 { ok:false, error }。 */
function uninstallPack(dataDir, packId) {
  const packs = readInstalledPacks(dataDir);
  const next = packs.filter((p) => p.packId !== packId);
  if (next.length === packs.length) return { ok: false, error: 'pack_not_installed' };
  writeInstalledPacks(dataDir, next);
  return { ok: true, removed: packId };
}

module.exports = {
  packsRecordFile,
  readInstalledPacks,
  writeInstalledPacks,
  validatePackDir,
  discoverAvailablePacks,
  installPack,
  uninstallPack,
};
