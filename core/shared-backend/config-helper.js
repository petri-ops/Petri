/**
 * shared-backend/config-helper.js — 统一读取 config 的入口（自洽版）
 *
 * 断点1（分仓前置）：斩断对 r-server/py-server 的反向 require。
 * 调用方（r-server/py-server/desktop）启动时调 configure({getConfig}) 注入自己的 config；
 * 未注入时从环境变量构造 fallback（保持原行为，shared-backend 仍能独立跑）。
 *
 * 历史上本模块按优先级 require r-server/config → py-server/config，那是"假独立"——
 * 分仓后 ../r-server/config 路径会断，initSharedBackend / 执行器 / 存储 / llm-providers 全炸。
 * 依赖反转后，shared-backend 真自洽，分仓安全。
 */

let _getConfig = null; // 注入的 config 提供函数

/**
 * 注入 config 提供函数。调用方启动时调一次。
 * @param {{getConfig: () => object}} provider
 */
function configure(provider) {
  if (provider && typeof provider.getConfig === 'function') {
    _getConfig = provider.getConfig;
  }
}

function getConfig() {
  // 优先用注入的
  if (_getConfig) return _getConfig();
  // fallback：从环境变量构造（真自洽，不依赖 r-server/py-server）
  return {
    execMode: process.env.BIOF3_EXEC_MODE || 'local',
    storageMode: process.env.BIOF3_STORAGE || 'local',
    localMode: process.env.BIOF3_LOCAL_MODE === '1',
    rHome: process.env.BIOF3_R_HOME || '',
    pyHome: process.env.BIOF3_PY_HOME || '',
    tempDir: process.env.BIOF3_TEMP_DIR || '/tmp/biof3-tmp',
    localResultsDir: process.env.BIOF3_LOCAL_RESULTS_DIR || '',
    localUploadsDir: process.env.BIOF3_LOCAL_UPLOADS_DIR || '',
  };
}

// 向后兼容：原 module.exports 是个 Proxy，字段访问（config.execMode）走 getConfig()。
// 现在导出一个 Proxy，对 configure/getConfig 两个方法名返回函数，其余走 getConfig()。
// 老代码 `const config = require('./config-helper'); config.execMode` 仍 work；
// 新代码 `const { configure, getConfig } = require('./config-helper')` 也 work。
module.exports = new Proxy(
  { configure, getConfig },
  {
    get(target, prop) {
      if (prop === 'configure') return configure;
      if (prop === 'getConfig') return getConfig;
      return getConfig()[prop];
    },
  }
);
