'use strict';

/**
 * pack-registry.js — 领域包安装注册表（BLOCK-84：产品级一键装/卸）
 *
 * 职责：领域包的发现（available）、安装记录（installed record）、校验与卸载。
 * 安装记录 = `<dataDir>/packs/installed.json`（数组），与插件 installed.json 先例同构。
 * 本模块只管记录与校验；boot 接线（插件源追加 + tool-registry 注册）由 server 启动时消费记录完成。
 *
 * 包契约（pack.json）：packId 必填；plugins/installed.json 必须存在（可装载性硬证据）。
 * BLOCK-86 P1 — `requires.runtimes` 契约：数据驱动声明依赖的运行时插件
 * （[{ pluginId, version? }]），装卸编排由契约推导（src/pack-lifecycle.js），
 * 本模块只做形状校验与记录，不写死任何领域/运行时字样。
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
    // BLOCK-157 加映（UI-481）— 整包启停：enabled 缺省 = 启用（存量零破坏），仅 false = 停用。
    return parsed
      .filter((item) => item && item.packId && item.packRoot)
      .map((item) => ({ ...item, enabled: item.enabled !== false }));
  } catch {
    return [];
  }
}

/**
 * BLOCK-157 加映（UI-481）— 整包启停：翻转 packs/installed.json 记录级 enabled 标志。
 * 停用 = 包文件不动（免重装），core 装配循环跳过该包（插件源与 tool-registry 注册整体不生效）。
 */
function setPackEnabled(dataDir, packId, enabled) {
  const packs = readInstalledPacks(dataDir);
  const row = packs.find((p) => p.packId === packId);
  if (!row) return { ok: false, error: 'pack_not_installed', message: `未安装领域包：${packId}` };
  writeInstalledPacks(dataDir, packs.map((p) => (p.packId === packId ? { ...p, enabled: enabled !== false } : p)));
  return { ok: true, packId, enabled: enabled !== false, restartRequired: true };
}

function writeInstalledPacks(dataDir, packs) {
  const file = packsRecordFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(packs, null, 2) + '\n', 'utf-8');
}

/**
 * BLOCK-86 P1 — 归一化 `requires.runtimes` 契约声明。
 * 合法形态：缺省 = []；数组，每项 { pluginId: 非空字符串, version?: 字符串 }。
 * 字段存在但形状错误 → 拒绝（fail loudly，不静默忽略包作者的笔误）。
 * 返回 { ok: true, runtimes } 或 { ok: false, error: 'pack_requires_runtimes_invalid' }。
 */
function normalizeRequiresRuntimes(requires) {
  if (!requires || requires.runtimes === undefined) return { ok: true, runtimes: [] };
  if (!Array.isArray(requires.runtimes)) return { ok: false, error: 'pack_requires_runtimes_invalid' };
  const runtimes = [];
  for (const item of requires.runtimes) {
    if (!item || typeof item !== 'object' || typeof item.pluginId !== 'string' || !item.pluginId.trim()) {
      return { ok: false, error: 'pack_requires_runtimes_invalid' };
    }
    if (item.version !== undefined && typeof item.version !== 'string') {
      return { ok: false, error: 'pack_requires_runtimes_invalid' };
    }
    runtimes.push(item.version !== undefined
      ? { pluginId: item.pluginId, version: item.version }
      : { pluginId: item.pluginId });
  }
  return { ok: true, runtimes };
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
  const runtimes = normalizeRequiresRuntimes(pack.requires);
  if (!runtimes.ok) return runtimes;
  return {
    ok: true,
    pack: {
      packId: pack.packId,
      name: pack.name || pack.packId,
      nameEn: pack.nameEn || null,
      version: pack.version || '0.0.0',
      description: pack.description || '',
      provides: pack.provides || {},
      requiresRuntimes: runtimes.runtimes,
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
    // BLOCK-86 P2 — 显示名随记录存档（缺失提示文案挂包名用；旧记录无此字段回退 packId）
    name: validated.pack.name,
    packRoot: validated.pack.packRoot,
    version: validated.pack.version,
    // BLOCK-86 P1 — 契约随记录存档：卸载编排由它推导（不重读包源也能推导）
    requiresRuntimes: validated.pack.requiresRuntimes,
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

/**
 * BLOCK-86 P1 — 卸载运行时移除计划（纯记录推导，主进程编排层的输入）。
 * 可移除 = 本包契约声明 且 不被任何其他已装包声明（运行时槽位按声明共享，
 * 单领域包前提下 removable 恒等于其全部声明，多包时诚实保留共享项）。
 * 返回 { ok, packId, removable: [pluginId], retained: [{ pluginId, requiredBy }] }
 * 或 { ok:false, error:'pack_not_installed' }。
 * 契约负例保障：无 requires.runtimes 的包 → removable 恒 []（编排层绝不触碰运行时）。
 */
function computeRuntimeRemovalPlan(dataDir, packId) {
  const packs = readInstalledPacks(dataDir);
  const target = packs.find((p) => p.packId === packId);
  if (!target) return { ok: false, error: 'pack_not_installed' };
  const declared = Array.isArray(target.requiresRuntimes) ? target.requiresRuntimes : [];
  const removable = [];
  const retained = [];
  for (const item of declared) {
    const others = packs
      .filter((p) => p.packId !== packId)
      .filter((p) => Array.isArray(p.requiresRuntimes) && p.requiresRuntimes.some((r) => r.pluginId === item.pluginId))
      .map((p) => p.packId);
    if (others.length > 0) retained.push({ pluginId: item.pluginId, requiredBy: others });
    else removable.push(item.pluginId);
  }
  return { ok: true, packId, removable, retained };
}

/**
 * BLOCK-86 P2 — 包内容清单概要（商店包卡片「功能模块」行与「分析工具」来源标注的数据源）。
 * 全部只读统计：缺目录/缺索引如实计 0，不抛错。
 */
function describePackContents(packRoot) {
  const result = { pluginCount: 0, plugins: [], pluginIds: [], scriptCount: 0, demoDataCount: 0 };
  try {
    const index = JSON.parse(fs.readFileSync(path.join(packRoot, 'plugins', 'installed.json'), 'utf-8'));
    if (Array.isArray(index)) {
      result.plugins = index
        .filter((item) => item && typeof item.id === 'string')
        .map((item) => ({ id: item.id, language: item.language || null, version: item.version || null }));
      result.pluginIds = result.plugins.map((p) => p.id);
      result.pluginCount = result.plugins.length;
    }
  } catch { /* 索引缺失 = 0 */ }
  try {
    result.scriptCount = fs.readdirSync(path.join(packRoot, 'scripts'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_')).length;
  } catch { /* 目录缺失 = 0 */ }
  try {
    result.demoDataCount = fs.readdirSync(path.join(packRoot, 'demo-data'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('_')).length;
  } catch { /* 目录缺失 = 0 */ }
  return result;
}

module.exports = {
  packsRecordFile,
  readInstalledPacks,
  setPackEnabled,
  writeInstalledPacks,
  normalizeRequiresRuntimes,
  validatePackDir,
  discoverAvailablePacks,
  describePackContents,
  installPack,
  uninstallPack,
  computeRuntimeRemovalPlan,
};
