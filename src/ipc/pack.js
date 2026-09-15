'use strict';

/**
 * IPC handlers: pack:* — 领域包一键装/卸（BLOCK-84）+ 契约推导生命周期编排（BLOCK-86 P1）。
 * 纯 Electron main 侧：dialog 选择目录 + pack-lifecycle 编排（记录 + 运行时联动）。
 * boot 接线（插件源/工具注册）由 biof3-server 启动消费记录完成；装/卸后需重启生效。
 * 编排逻辑全部在 src/pack-lifecycle.js（可测），此处只做 IPC 装配与进度转发。
 */

const { ipcMain, dialog } = require('electron');
const path = require('path');
const { createPackLifecycle } = require('../pack-lifecycle');

function getDataDir() {
  // 与 BLOCK-79 环境事实同源：BIOF3_LOCAL_DATA_DIR 由 dev-electron/主进程注入
  return process.env.BIOF3_LOCAL_DATA_DIR
    || path.join(require('os').homedir(), 'Documents', 'Gewu-Local');
}

const lifecycle = createPackLifecycle();

/** 运行时下载进度转发到发起方渲染进程（P2 商店卡片消费）。 */
function forwardRuntimeProgress(event, pluginId, progress) {
  try {
    if (event && event.sender && !event.sender.isDestroyed()) {
      event.sender.send('pack:install-progress', { pluginId, progress });
    }
  } catch { /* 发起方已关闭：进度无处可送，忽略 */ }
}

function registerPackIpc() {
  // BLOCK-86 P2 — 内容概要只读统计（缺目录如实计 0，绝不抛错阻断商店渲染）
  function enrichContents(packRegistry, packRoot) {
    try {
      return packRegistry.describePackContents(packRoot);
    } catch {
      return { pluginCount: 0, pluginIds: [], scriptCount: 0, demoDataCount: 0 };
    }
  }

  ipcMain.handle('pack:list-installed', async () => {
    const packRegistry = require('../../core/shared-backend/pack-registry');
    const packs = packRegistry.readInstalledPacks(getDataDir());
    // 记录含 packRoot——即使包源稍后被删，卸载前也能展示模块清单
    return {
      ok: true,
      packs: packs.map((p) => ({ ...p, contents: enrichContents(packRegistry, p.packRoot) })),
    };
  });

  ipcMain.handle('pack:list-available', async () => {
    const packRegistry = require('../../core/shared-backend/pack-registry');
    const available = packRegistry.discoverAvailablePacks({ projectRoot: process.env.BIOF3_PROJECT_ROOT || path.resolve(__dirname, '..', '..') });
    const installed = packRegistry.readInstalledPacks(getDataDir());
    const installedIds = new Set(installed.map((p) => p.packId));
    return {
      ok: true,
      packs: available.map((p) => ({
        ...p,
        installed: installedIds.has(p.packId),
        contents: enrichContents(packRegistry, p.packRoot),
      })),
    };
  });

  // 一键安装：主进程弹目录选择框（选中含 pack.json 的目录）
  ipcMain.handle('pack:install-from-dialog', async (event) => {
    const result = await dialog.showOpenDialog({
      title: '选择领域包目录（含 pack.json）',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }
    return lifecycle.installPackWithRuntimes(getDataDir(), result.filePaths[0], {
      onRuntimeProgress: (pluginId, progress) => forwardRuntimeProgress(event, pluginId, progress),
    });
  });

  // 一键安装（已知路径，如兄弟仓自动发现条目）
  ipcMain.handle('pack:install-path', async (event, packRoot) => {
    if (!packRoot || typeof packRoot !== 'string') return { ok: false, error: 'pack_root_required' };
    return lifecycle.installPackWithRuntimes(getDataDir(), packRoot, {
      onRuntimeProgress: (pluginId, progress) => forwardRuntimeProgress(event, pluginId, progress),
    });
  });

  // BLOCK-86 P1 — 卸载影响预览：确认弹层三档数据源（运行时回收体积/共享保留/包源）
  ipcMain.handle('pack:uninstall-plan', async (_event, packId) => {
    if (!packId || typeof packId !== 'string') return { ok: false, error: 'pack_id_required' };
    return lifecycle.buildUninstallPlan(getDataDir(), packId);
  });

  // 卸载执行：deleteRuntimes / deletePackSource 缺省 false（破坏性动作必须显式勾选）
  ipcMain.handle('pack:uninstall', async (_event, packId, options) => {
    if (!packId || typeof packId !== 'string') return { ok: false, error: 'pack_id_required' };
    const opts = options && typeof options === 'object' ? options : {};
    return lifecycle.executeUninstall(getDataDir(), packId, {
      deleteRuntimes: opts.deleteRuntimes === true,
      deletePackSource: opts.deletePackSource === true,
    });
  });
}

module.exports = { registerPackIpc, getDataDir };
