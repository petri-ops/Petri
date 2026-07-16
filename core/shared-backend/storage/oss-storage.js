/**
 * OSS Storage — 阿里云 OSS 存储适配器
 *
 * Web 版默认存储后端。从现有 r-server / py-server 的 OSS 逻辑抽取，
 * 实现 StorageAdapter 接口，保持 web 版行为不变。
 *
 * 桌面版不注册此适配器（BIOF3_STORAGE=local 时用 LocalFileStorage）。
 */

const path = require('path');
const fs = require('fs');
const logger = require('../logger');

// 从 config-helper 读取配置（断点1：斩断对 r-server/config 的反向 require）
const configHelper = require('../config-helper');
function getRConfig() {
  return configHelper.getConfig();
}

function _getOssConfig() {
  const cfg = getRConfig();
  return (
    cfg.oss || {
      region: process.env.OSS_REGION || 'oss-cn-hangzhou',
      accessKeyId: process.env.OSS_AK || '',
      accessKeySecret: process.env.OSS_SK || '',
      bucket: process.env.OSS_BUCKET || 'biof3-uploads',
      endpoint: process.env.OSS_ENDPOINT || 'oss-cn-hangzhou.aliyuncs.com',
    }
  );
}

function _getOssHost() {
  const oss = _getOssConfig();
  return `https://${oss.bucket}.${oss.endpoint}`;
}

// 延迟加载 ali-oss（桌面版不装这个依赖）
let _OssClient = null;
function _getOssClient() {
  if (_OssClient) return _OssClient;
  const oss = _getOssConfig();
  if (!oss.accessKeyId || !oss.accessKeySecret) return null;
  try {
    const OSS = require('ali-oss');
    _OssClient = new OSS({
      region: oss.region,
      accessKeyId: oss.accessKeyId,
      accessKeySecret: oss.accessKeySecret,
      bucket: oss.bucket,
      endpoint: oss.endpoint,
    });
    return _OssClient;
  } catch (e) {
    logger.warn(`[oss-storage] ali-oss 不可用: ${e.message}`);
    return null;
  }
}

class OSSStorage {
  get name() {
    return 'oss';
  }

  /**
   * 上传文件到 OSS。
   * @param {string} localPath - 源文件路径
   * @param {string} key - OSS 存储键
   * @returns {Promise<string>} - OSS 公网 URL
   */
  async upload(localPath, key) {
    const client = _getOssClient();
    if (!client) {
      // fallback: 返回本地路径（不应该发生在 web 版生产环境）
      logger.warn(`[oss-storage] OSS client 不可用，fallback 到本地路径`);
      return `/api/files/${key}`;
    }
    try {
      await client.put(key, localPath);
      const url = `${_getOssHost()}/${key}`;
      logger.debug(`[oss-storage] uploaded: ${key}`);
      return url;
    } catch (e) {
      logger.error(`[oss-storage] upload failed: ${key}`, { error: e.message });
      throw e;
    }
  }

  /**
   * 生成 OSS 公网 URL。
   */
  getUrl(key) {
    return `${_getOssHost()}/${key}`;
  }

  /**
   * 从 OSS 下载文件到本地。
   */
  async download(key, localPath) {
    const client = _getOssClient();
    if (!client) throw new Error('OSS client 不可用');
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    await client.get(key, localPath);
  }

  /**
   * 删除 OSS 上的文件。
   */
  async delete(key) {
    const client = _getOssClient();
    if (!client) return;
    try {
      await client.delete(key);
      logger.debug(`[oss-storage] deleted: ${key}`);
    } catch (e) {
      logger.warn(`[oss-storage] delete failed: ${key}`, { error: e.message });
    }
  }

  /**
   * 生成 OSS 签名上传 URL（前端直传场景）。
   * 返回签名 URL + 文件访问 URL + key。
   */
  getUploadUrl(key) {
    const client = _getOssClient();
    if (!client) return { uploadUrl: '/api/upload', fileUrl: `/api/files/${key}`, key };

    const expires = 600; // 10 分钟
    const url = client.signatureUrl(key, {
      method: 'PUT',
      expires,
    });
    const fileUrl = `${_getOssHost()}/${key}`;
    return { uploadUrl: url, fileUrl, key };
  }

  exists(key) {
    // OSS 不支持同步 exists，这里返回 true（调用方应 catch download 错误）
    return true;
  }
}

module.exports = { OSSStorage };
