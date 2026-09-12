'use strict';

/**
 * IPC handlers: pack:* (5 handlers) — 领域包一键装/卸（BLOCK-84）。
 * 纯 Electron main 侧：dialog 选择目录 + pack-registry 记录读写。
 * boot 接线（插件源/工具注册）由 biof3-server 启动消费记录完成；装/卸后需重启生效。
 */

const { ipcMain, dialog } = require('electron');
const path = require('path');
const packRegistry = require('../../core/shared-backend/pack-registry');

function getDataDir() {
  // 与 BLOCK-79 环境事实同源：BIOF3_LOCAL_DATA_DIR 由 dev-electron/主进程注入
  return process.env.BIOF3_LOCAL_DATA_DIR
    || path.join(require('os').homedir(), 'Documents', 'Gewu-Local');
}

function registerPackIpc() {
  ipcMain.handle('pack:list-installed', async () => {
    return { ok: true, packs: packRegistry.readInstalledPacks(getDataDir()) };
  });

  ipcMain.handle('pack:list-available', async () => {
    const available = packRegistry.discoverAvailablePacks({ projectRoot: process.env.BIOF3_PROJECT_ROOT || path.resolve(__dirname, '..', '..') });
    const installed = packRegistry.readInstalledPacks(getDataDir());
    const installedIds = new Set(installed.map((p) => p.packId));
    return {
      ok: true,
      packs: available.map((p) => ({ ...p, installed: installedIds.has(p.packId) })),
    };
  });

  // 一键安装：主进程弹目录选择框（选中含 pack.json 的目录）
  ipcMain.handle('pack:install-from-dialog', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择领域包目录（含 pack.json）',
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths.length) {
      return { ok: false, canceled: true };
    }
    return packRegistry.installPack(getDataDir(), result.filePaths[0]);
  });

  // 一键安装（已知路径，如兄弟仓自动发现条目）
  ipcMain.handle('pack:install-path', async (_event, packRoot) => {
    if (!packRoot || typeof packRoot !== 'string') return { ok: false, error: 'pack_root_required' };
    return packRegistry.installPack(getDataDir(), packRoot);
  });

  ipcMain.handle('pack:uninstall', async (_event, packId) => {
    if (!packId || typeof packId !== 'string') return { ok: false, error: 'pack_id_required' };
    return packRegistry.uninstallPack(getDataDir(), packId);
  });
}

module.exports = { registerPackIpc, getDataDir };
