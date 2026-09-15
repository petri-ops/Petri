'use strict';

/**
 * pack-lifecycle.js — 领域包装卸编排（BLOCK-86 P1）
 *
 * 职责：把 BLOCK-84 的「记录制装/卸」升级为「契约推导的整包生命周期」——
 *   装 = 写记录 + 依次触发 requires.runtimes 声明的运行时安装（复用 installPlugin
 *        进度链；单运行时失败不回滚记录，缺项如实上报，P2 商店卡片据此提示补装）。
 *   卸 = 三档数据策略（领域资产删 / 用户数据永不动 / 包源目录默认保留）+
 *        契约推导卸运行时（computeRuntimeRemovalPlan：本包声明且无其他已装包共享）
 *        + 「删了什么/留了什么」报告。
 *
 * 实现纪律：编排只读包契约（requires.runtimes），不写死任何领域/运行时字样——
 * 新领域包照契约填内容即可，本文件零改动（对齐 BLOCK-83 D7 棘轮）。
 *
 * 可测性：createPackLifecycle(deps) 依赖注入（registry / 已装插件表 / 安装 /
 * 卸载 / 运行时目录 / 体积统计），契约测试以假件驱动全部分支；Electron IPC
 * （src/ipc/pack.js）用真件装配一个单例。
 */

const path = require('path');
const fs = require('fs');

function createPackLifecycle(deps = {}) {
  const registry = deps.registry || require('../core/shared-backend/pack-registry');
  const getInstalledPlugins = deps.getInstalledPlugins
    || (() => require('./plugin-manager').getInstalledPlugins());
  const installPlugin = deps.installPlugin
    || ((pluginId, onProgress) => require('./plugin-manager').installPlugin(pluginId, onProgress));
  const uninstallRuntime = deps.uninstallRuntime
    || ((pluginId, plug) => require('./plugin/uninstall').uninstallRuntime(pluginId, plug));
  const runtimesDir = deps.runtimesDir
    || (() => require('./plugin/paths').RUNTIMES_DIR);
  const dirSize = deps.dirSize
    || ((dir) => require('./plugin/io').dirSize(dir));
  const rmDir = deps.rmDir
    || ((dir) => require('fs').rmSync(dir, { recursive: true, force: true }));
  // BLOCK-86 P3 实机抓真 — 运行时在位判定不能只看插件安装记录：运行时可能由
  // 链外供给（手动放置/系统解析，如本机 R），plugin installed.json 里没有记录。
  // 补两条判据：runtimeStatus（R/Python 目录+可执行探测）+ 清单 language 映射。
  const getRuntimeStatus = deps.getRuntimeStatus
    || (() => require('./plugin/runtime').getRuntimeStatus());
  const getManifestLanguage = deps.getManifestLanguage
    || (async (pluginId) => {
      const manifest = await require('./plugin-manager').getRemoteManifest();
      return (manifest.plugins && manifest.plugins[pluginId] && manifest.plugins[pluginId].language) || null;
    });

  // 与 src/plugin/uninstall.js uninstallRuntime 的目录约定保持一致（仅用于
  // 体积预估；删除动作永远由 uninstallRuntime 单点执行，此处不做任何删除）。
  function runtimeDirFor(lang) {
    const runtimeName = lang === 'r' ? 'R' : 'Python';
    return path.join(runtimesDir(), runtimeName);
  }

  // BLOCK-86 P3 实机抓真 — 运行时在位判定不能只看插件安装记录：运行时可能由
  // 链外供给（手动放置/系统解析，如本机 R），plugin installed.json 里没有记录。
  // 返回 { plug（记录 plug 或按语言合成的最小 plug）, recordPresent,
  // statusPresent（runtimeStatus 目录+可执行探测）, lang }。
  async function locateRuntime(pluginId, installed) {
    const plug = installed.find((p) => p && p.id === pluginId) || null;
    let lang = plug && plug.language;
    if (!lang) {
      try { lang = await getManifestLanguage(pluginId); } catch { lang = null; }
    }
    const status = (() => { try { return getRuntimeStatus(); } catch { return null; } })();
    const entry = status && status[lang === 'r' ? 'r' : 'python'];
    return {
      plug: plug || (lang ? { id: pluginId, language: lang } : null),
      recordPresent: Boolean(plug),
      statusPresent: Boolean(entry && entry.installed),
      lang: lang || null,
    };
  }

  /**
   * 安装：记录 upsert → 契约推导逐个补装运行时。
   * 返回 { ok, pack, installed, updated, runtimes: [{ pluginId, ok, skipped?, error? }], requiresRestart }
   * 语义：记录安装成功即 ok=true；运行时缺失/失败如实列在 runtimes（不回滚）。
   */
  async function installPackWithRuntimes(dataDir, packRoot, { onRuntimeProgress } = {}) {
    const res = registry.installPack(dataDir, packRoot);
    if (!res.ok) return res;
    const declared = Array.isArray(res.pack.requiresRuntimes) ? res.pack.requiresRuntimes : [];
    const installed = getInstalledPlugins() || [];
    const runtimes = [];
    for (const item of declared) {
      const located = await locateRuntime(item.pluginId, installed);
      if (located.recordPresent) {
        runtimes.push({ pluginId: item.pluginId, ok: true, skipped: 'already_installed' });
        continue;
      }
      if (located.statusPresent) {
        // 链外供给的运行时（目录+可执行在位但无安装记录）同样不重装
        runtimes.push({ pluginId: item.pluginId, ok: true, skipped: 'runtime_present' });
        continue;
      }
      try {
        await installPlugin(item.pluginId, onRuntimeProgress
          ? (progress) => onRuntimeProgress(item.pluginId, progress)
          : undefined);
        runtimes.push({ pluginId: item.pluginId, ok: true });
      } catch (error) {
        runtimes.push({ pluginId: item.pluginId, ok: false, error: error && error.message });
      }
    }
    return {
      ...res,
      runtimes,
      requiresRestart: runtimes.some((r) => r.ok && !r.skipped),
    };
  }

  /**
   * 卸载影响预览（确认弹层的数据源，主进程富化体积/在位状态）。
   * 返回 { ok, packId, requiresRuntimes, runtimes: { removable, retained },
   *        packSource: { dir, exists, sizeBytes }, userDataPolicy }。
   */
  async function buildUninstallPlan(dataDir, packId) {
    const plan = registry.computeRuntimeRemovalPlan(dataDir, packId);
    if (!plan.ok) return plan;
    const record = registry.readInstalledPacks(dataDir).find((p) => p.packId === packId);
    const installed = getInstalledPlugins() || [];
    const removable = [];
    for (const pluginId of plan.removable) {
      const located = await locateRuntime(pluginId, installed);
      let sizeBytes = null;
      if (located.statusPresent || located.plug) {
        try { sizeBytes = dirSize(runtimeDirFor(located.lang)); } catch { sizeBytes = null; }
      }
      removable.push({
        pluginId,
        installed: located.statusPresent,
        sizeBytes: Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : null,
      });
    }
    const dir = record ? record.packRoot : null;
    let packSource = { dir, exists: false, sizeBytes: null };
    if (dir) {
      try {
        packSource = { dir, exists: fs.existsSync(dir), sizeBytes: null };
        if (packSource.exists) packSource.sizeBytes = dirSize(dir);
      } catch { /* 体积统计失败如实留空 */ }
    }
    return {
      ok: true,
      packId,
      requiresRuntimes: Array.isArray(record && record.requiresRuntimes) ? record.requiresRuntimes : [],
      runtimes: { removable, retained: plan.retained },
      packSource,
      // 三档语义（确认弹层文案依据）：领域资产删=removable 运行时+（可选）包源；
      // 用户数据永不触碰；包源目录默认保留（演示数据/脚本/插件内容都在其中）。
      userDataPolicy: 'results、项目文件与数据库不受影响',
    };
  }

  /**
   * 执行卸载：记录移除 →（可选）契约推导卸运行时 →（可选）删包源目录。
   * deleteRuntimes / deletePackSource 缺省 false——破坏性动作必须显式勾选。
   * 返回卸载报告：{ ok, packId, removed: { record, runtimes, packSourceDir? },
   *              kept: { packSourceDir?, userDataPolicy }, requiresRestart, error? }。
   */
  async function executeUninstall(dataDir, packId, { deleteRuntimes = false, deletePackSource = false } = {}) {
    const plan = registry.computeRuntimeRemovalPlan(dataDir, packId);
    if (!plan.ok) return { ok: false, error: plan.error };
    const record = registry.readInstalledPacks(dataDir).find((p) => p.packId === packId);
    const removed = { record: false, runtimes: [] };
    const kept = { userDataPolicy: 'results、项目文件与数据库不受影响' };

    const uninstallRes = registry.uninstallPack(dataDir, packId);
    if (!uninstallRes.ok) return { ok: false, error: uninstallRes.error };
    removed.record = true;

    if (deleteRuntimes) {
      const installed = getInstalledPlugins() || [];
      for (const pluginId of plan.removable) {
        const located = await locateRuntime(pluginId, installed);
        if (!located.statusPresent && !located.recordPresent) {
          removed.runtimes.push({ pluginId, ok: true, skipped: 'not_installed' });
          continue;
        }
        try {
          // located.plug 兜底为按语言合成的最小 plug（链外供给的运行时）
          await uninstallRuntime(pluginId, located.plug);
          removed.runtimes.push({ pluginId, ok: true });
        } catch (error) {
          removed.runtimes.push({ pluginId, ok: false, error: error && error.message });
        }
      }
    }

    if (deletePackSource) {
      // 破坏性护栏：只删记录指向、且确实含 pack.json 的目录（防错删任意路径）。
      const dir = record && record.packRoot;
      let packJsonOk = false;
      try { packJsonOk = Boolean(dir) && require('fs').existsSync(path.join(dir, 'pack.json')); } catch { packJsonOk = false; }
      if (!packJsonOk) {
        kept.packSourceDir = dir || null;
        kept.packSourceError = 'pack_source_guard_failed';
      } else {
        try {
          rmDir(dir);
          removed.packSourceDir = dir;
        } catch (error) {
          kept.packSourceDir = dir;
          kept.packSourceError = error && error.message;
        }
      }
    } else {
      kept.packSourceDir = (record && record.packRoot) || null;
    }

    return {
      ok: true,
      packId,
      removed,
      kept,
      requiresRestart: removed.runtimes.some((r) => r.ok && !r.skipped),
    };
  }

  return { installPackWithRuntimes, buildUninstallPlan, executeUninstall };
}

module.exports = { createPackLifecycle };
