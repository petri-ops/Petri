/**
 * Storage Adapter Registry — 存储适配器注册表
 *
 * 桌面版只使用 LocalFileStorage（本地文件系统）。petri-server
 * 通过 getActiveStorage() 获取，避免各自重复实现文件操作。
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
const _capabilities = new Map();
let _activeName = null;

// RW-05 — 能力协商：适配器声明 supports_* 能力位，消费方按能力分支（可插拔）。
// 开放词汇表：未知键 fail-closed 忽略（不授予）；未声明的适配器 = 全 false 形态。
const KNOWN_CAPABILITY_KEYS = Object.freeze([
  'supportsDirectUpload',
  'supportsDelete',
  'supportsPresignedUrl',
  'supportsServerSideCopy',
  'supportsRetentionPolicy',
]);

function declareStorageCapabilities(name, capabilities) {
  if (!_storages.has(name)) {
    throw new Error(`declareStorageCapabilities: 适配器未注册: ${name}`);
  }
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) {
    throw new Error('declareStorageCapabilities: capabilities must be an object');
  }
  const normalized = {};
  for (const [key, value] of Object.entries(capabilities)) {
    if (!KNOWN_CAPABILITY_KEYS.includes(key)) continue; // 未知键 fail-closed 忽略
    if (typeof value !== 'boolean') continue; // 非布尔不授予
    normalized[key] = value;
  }
  _capabilities.set(name, { name, ...normalized });
  logger.info(`[storage] capabilities declared: ${name}`);
}

function getStorageCapabilities(name) {
  if (!_storages.has(name)) {
    throw new Error(`存储适配器未注册: ${name}`);
  }
  return _capabilities.get(name) || { name };
}

function getActiveStorageCapabilities() {
  return getStorageCapabilities(_activeName || 'local');
}

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
  const name = _activeName || 'local';
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
  declareStorageCapabilities,
  getStorageCapabilities,
  getActiveStorageCapabilities,
  KNOWN_CAPABILITY_KEYS,
};
