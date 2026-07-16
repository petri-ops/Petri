/**
 * shared-backend/init.js — 桌面版启动时注册所有执行器和存储适配器
 *
 * r-server / py-server 启动时 require 本模块，自动注册：
 *   - R 执行器（RExecutor）
 *   - Python 执行器（PyExecutor）
 *   - 本地存储适配器（LocalFileStorage）
 *   - OSS 存储适配器（OSSStorage，仅 web 模式）
 *
 * 根据 config 自动选择激活的存储适配器。
 */

const config = require('./config-helper');

// 执行器注册表
const { registerExecutor } = require('./executors');

// 存储注册表
const { registerStorage, setActiveStorage } = require('./storage');

let _initialized = false;

function initSharedBackend() {
  if (_initialized) return;
  _initialized = true;

  const execMode = config.execMode || 'docker';
  const storageMode = config.storageMode || (execMode === 'local' ? 'local' : 'oss');

  // ── 注册执行器 ──────────────────────────────────────────────
  try {
    const { RExecutor } = require('./executors/r-executor');
    registerExecutor(new RExecutor());
  } catch (e) {
    console.warn('[init] R executor registration failed:', e.message);
  }

  try {
    const { PythonExecutor } = require('./executors/py-executor');
    registerExecutor(new PythonExecutor());
  } catch (e) {
    console.warn('[init] Python executor registration failed:', e.message);
  }

  // ── 注册存储适配器 ──────────────────────────────────────────
  try {
    const { LocalFileStorage } = require('./storage/local-storage');
    registerStorage('local', new LocalFileStorage());
  } catch (e) {
    console.warn('[init] Local storage registration failed:', e.message);
  }

  if (storageMode === 'oss') {
    try {
      const { OSSStorage } = require('./storage/oss-storage');
      registerStorage('oss', new OSSStorage());
    } catch (e) {
      console.warn('[init] OSS storage registration failed:', e.message);
    }
  }

  // ── 激活存储适配器 ──────────────────────────────────────────
  try {
    setActiveStorage(storageMode);
  } catch (e) {
    console.warn(`[init] cannot activate storage "${storageMode}":`, e.message);
  }
}

module.exports = { initSharedBackend };
