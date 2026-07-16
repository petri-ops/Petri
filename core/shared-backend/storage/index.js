/**
 * Storage Adapter Registry — 存储适配器注册表
 *
 * 桌面版用 LocalFileStorage（本地文件系统）。适配器实现统一接口，
 * r-server / py-server 通过 getActiveStorage() 获取，不直接引用本地路径，
 * 保留存储后端可切换的扩展点。
 *
 * 接口规范（StorageAdapter）：
 *   name           — 'local' | ...
 *   upload(localPath, key) → Promise<string>   上传文件，返回可访问 URL
 *   getUrl(key) → string                       生成文件访问 URL
 *   download(key, localPath) → Promise<void>   下载文件到本地
 *   delete(key) → Promise<void>                删除文件
 *   getUploadUrl(key) → string                 生成上传目标 URL（前端直传）
 */

const logger = require('../logger');

const _storages = new Map();
let _activeName = null;

function registerStorage(name, adapter) {
  if (!name || !adapter) {
    throw new Error('registerStorage: name and adapter are required');
  }
  _storages.set(name, adapter);
  logger.info(`[storage] registered: ${name}`);
}

function getStorage(name) {
  return _storages.get(name);
}

function getActiveStorage() {
  const name = _activeName || process.env.BIOF3_STORAGE || 'local';
  const adapter = _storages.get(name);
  if (!adapter) {
    throw new Error(`存储适配器未注册: ${name}`);
  }
  return adapter;
}

function setActiveStorage(name) {
  if (!_storages.has(name)) {
    throw new Error(`存储适配器未注册: ${name}`);
  }
  _activeName = name;
  logger.info(`[storage] active: ${name}`);
}

function listStorages() {
  return Array.from(_storages.keys());
}

module.exports = {
  registerStorage,
  getStorage,
  getActiveStorage,
  setActiveStorage,
  listStorages,
};
