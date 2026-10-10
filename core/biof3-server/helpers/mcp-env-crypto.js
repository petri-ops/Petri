'use strict';

/**
 * helpers/mcp-env-crypto.js — MCP env 值落盘加密（BLOCK-160 W2 P4/CAP-2）。
 *
 * 机制（设计偏离登记 BLOCK-160 plan §2）：预裁决语义为「Electron safeStorage」，
 * 但 mcp-servers.json 的 IO 在 biof3-server 进程（无 Electron API）→ 采用
 * core 侧 AES-256-GCM + 本地密钥文件（$BIOF3_LOCAL_DATA_DIR/keys/mcp-env.key，
 * 首次使用生成 32 字节随机密钥）。效果等价：**落盘零明文**；密文格式
 * `enc:v1:<iv>.<tag>.<cipher>`（均 hex）。
 *
 * 语义：decryptSecret 对无前缀字符串透传（存量明文迁移语义）；解密失败
 * （密钥丢失/轮换）诚实降级返回空串 + warn——不崩、不伪明文。
 */

const crypto = require('node:crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PREFIX = 'enc:v1:';

function keyFile() {
  const dir = process.env.BIOF3_LOCAL_DATA_DIR
    || path.join(os.homedir(), 'Documents', 'BioF3-Local');
  return path.join(dir, 'keys', 'mcp-env.key');
}

let _keyCache = null;

function loadKey() {
  if (_keyCache) return _keyCache;
  const file = keyFile();
  try {
    const hex = fs.readFileSync(file, 'utf8').trim();
    const key = Buffer.from(hex, 'hex');
    if (key.length === 32) {
      _keyCache = key;
      return key;
    }
  } catch { /* 首次使用：文件不存在 */ }
  const key = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, key.toString('hex') + '\n', { mode: 0o600 });
  } catch {
    // 极端环境（只读目录）：退化为进程内临时密钥（本次进程可解，重启后旧密文降级空值——诚实）
  }
  _keyCache = key;
  return key;
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + `${iv.toString('hex')}.${tag.toString('hex')}.${enc.toString('hex')}`;
}

function decryptSecret(value) {
  if (typeof value !== 'string' || !value.startsWith(PREFIX)) {
    return value; // 存量明文透传（迁移语义）
  }
  try {
    const [ivHex, tagHex, dataHex] = value.slice(PREFIX.length).split('.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return dec.toString('utf8');
  } catch (e) {
    console.warn('[mcp-env-crypto] decrypt failed (key lost/rotated?), degrading to empty:', e.message);
    return '';
  }
}

/** 测试钩子：清密钥缓存（密钥丢失场景模拟用）。 */
function _resetKeyCacheForTests() {
  _keyCache = null;
}

module.exports = {
  encryptSecret,
  decryptSecret,
  _resetKeyCacheForTests,
};
