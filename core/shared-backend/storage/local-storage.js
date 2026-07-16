/**
 * Local File Storage — 本地文件存储适配器
 *
 * 桌面版默认存储后端。所有文件操作走本地文件系统，
 * URL 返回 /api/files/<key> 路由路径，由 r-server 的 files-local 路由提供下载。
 */

const path = require('path');
const fs = require('fs');
const logger = require('../logger');

// 从 config-helper 读取配置（断点1：斩断对 r-server/config 的反向 require）
const configHelper = require('../config-helper');
function getRConfig() {
  return configHelper.getConfig();
}

function _getResultsDir() {
  const cfg = getRConfig();
  return (
    cfg.localResultsDir || path.join(require('os').homedir(), 'Documents', 'BioF3-Local', 'results')
  );
}

class LocalFileStorage {
  get name() {
    return 'local';
  }

  /**
   * 上传文件（本地 = 复制到 results 目录）。
   * @param {string} localPath - 源文件路径
   * @param {string} key - 存储键（如 results/job123/volcano.png）
   * @returns {Promise<string>} - 可访问的 URL 路径
   */
  async upload(localPath, key) {
    const resultsDir = _getResultsDir();
    const target = path.join(resultsDir, key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(localPath, target);
    logger.debug(`[local-storage] uploaded: ${key}`);
    return this.getUrl(key);
  }

  /**
   * 生成文件访问 URL。
   * 桌面版返回 /api/files/<key>，由本地文件路由处理。
   */
  getUrl(key) {
    return `/api/files/${key}`;
  }

  /**
   * 下载文件（本地 = 从 results 目录复制到指定路径）。
   */
  async download(key, localPath) {
    const resultsDir = _getResultsDir();
    const src = path.join(resultsDir, key);
    if (!fs.existsSync(src)) {
      throw new Error(`文件不存在: ${key}`);
    }
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.copyFileSync(src, localPath);
  }

  /**
   * 删除文件。
   */
  async delete(key) {
    const resultsDir = _getResultsDir();
    const target = path.join(resultsDir, key);
    try {
      fs.unlinkSync(target);
      logger.debug(`[local-storage] deleted: ${key}`);
    } catch (e) {
      // 文件不存在不算错误
      if (e.code !== 'ENOENT') throw e;
    }
  }

  /**
   * 生成上传目标 URL。
   * 桌面版：前端直接 POST /api/upload，multer 存到本地 uploads 目录。
   * 不需要 OSS 签名。
   */
  getUploadUrl(key) {
    return '/api/upload';
  }

  /**
   * 检查文件是否存在。
   */
  exists(key) {
    const resultsDir = _getResultsDir();
    return fs.existsSync(path.join(resultsDir, key));
  }

  /**
   * 读取文件内容（Buffer）。
   */
  read(key) {
    const resultsDir = _getResultsDir();
    return fs.readFileSync(path.join(resultsDir, key));
  }
}

module.exports = { LocalFileStorage };
