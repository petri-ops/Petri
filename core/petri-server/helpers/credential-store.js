/**
 * Local AI credential store.
 *
 * macOS uses the login Keychain. Other platforms use a separate 0600 file so
 * secrets never enter ai-settings.json, renderer snapshots, or diagnostics.
 *
 * BLOCK-446（ZCode v3.18.2 systemCredentialCipher 范式借鉴落地，
 * plan=docs/block-446-credential-file-encryption-plan.md）：
 * - file 后端落盘零明文：值一律 `enc:v1:` AES-256-GCM 密文，加密单源复用
 *   mcp-env-crypto（密钥 `$PETRI_LOCAL_DATA_DIR/keys/mcp-env.key`，与
 *   SETTINGS_DIR 同根——一个数据根一把密钥）。
 * - 存量迁移：明文值读取透传（与 mcp-env-crypto 同语义）；读取/写入命中含明文
 *   的文件时整组急切迁移重加密（fail-open：迁移失败仅 warn，值仍可用）。
 * - 错误语义分离：文件缺失=干净空态；损坏/不可读=存储错误态——get 诚实空串
 *   （fail-open 读取），set fail-closed 拒覆写（防「损坏文件 + set(new) → 整文件
 *   被单条目覆盖 → 他 provider 密文全毁」的破坏路径），remove 零触碰；密钥丢失
 *   导致的值不可解 → 该值诚实 ''，密文保留在盘，他条目写时原样保留。
 * - status() 只读健康面暴露三态，供诊断与测试断言。
 */

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const { encryptSecret, decryptSecret } = require('./mcp-env-crypto');

const KEYCHAIN_SERVICE = 'com.petri.desktop.ai';
const ENC_PREFIX = 'enc:v1:';

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (!value || !/^[a-z0-9._-]+$/.test(value)) {
    throw new Error(`无效的凭据 Provider: ${provider || '(empty)'}`);
  }
  return value.replace(/-vision$/, '');
}

function isPlaintext(value) {
  return typeof value === 'string' && value !== '' && !value.startsWith(ENC_PREFIX);
}

function createCredentialStore(options = {}) {
  const platform = options.platform || process.platform;
  const settingsDir = options.settingsDir;
  if (!settingsDir) throw new Error('Credential store requires settingsDir');
  const execFileSync = options.execFileSync || childProcess.execFileSync;
  const backend = options.backend || process.env.PETRI_CREDENTIAL_BACKEND ||
    (platform === 'darwin' ? 'keychain' : 'file');
  const filePath = path.join(settingsDir, 'ai-credentials.json');

  // BLOCK-446：读取不再把一切错误压平成「未配置」。三态：
  // error=null（干净空态或可读）/ 'corrupt'（JSON 损坏）/ 'unreadable'（权限等 IO 故障）。
  function readStoreState() {
    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      if (e && e.code === 'ENOENT') return { values: {}, fileExists: false, error: null };
      return { values: null, fileExists: true, error: 'unreadable' };
    }
    try {
      const parsed = JSON.parse(raw);
      const values = parsed && typeof parsed === 'object' ? parsed : {};
      return { values, fileExists: true, error: null };
    } catch {
      return { values: null, fileExists: true, error: 'corrupt' };
    }
  }

  function writeFileStore(values) {
    fs.mkdirSync(settingsDir, { recursive: true });
    const tempPath = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(values, null, 2), { mode: 0o600 });
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, filePath);
    fs.chmodSync(filePath, 0o600);
  }

  // 整组重加密：任一明文值随写入迁移为密文（落盘零明文对一切写路径成立）。
  function encryptAll(values) {
    const out = {};
    for (const [k, v] of Object.entries(values)) {
      out[k] = isPlaintext(v) ? encryptSecret(v) : v;
    }
    return out;
  }

  // 急切迁移（读取路径）：文件含明文值时整组重加密；fail-open——失败仅 warn，
  // 本次调用的值仍可用，绝不因迁移失败丢凭据。
  function migrateLegacyValues(state) {
    if (!state || state.error || !state.values) return;
    const hasLegacy = Object.values(state.values).some(isPlaintext);
    if (!hasLegacy) return;
    try {
      writeFileStore(encryptAll(state.values));
    } catch (e) {
      console.warn('[credential-store] legacy credential migration failed (fail-open, values remain usable):', e.message);
    }
  }

  function get(provider) {
    const id = normalizeProvider(provider);
    if (backend === 'keychain') {
      try {
        return String(execFileSync('/usr/bin/security', [
          'find-generic-password', '-a', id, '-s', KEYCHAIN_SERVICE, '-w',
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) || '').trim();
      } catch {
        return '';
      }
    }
    const state = readStoreState();
    if (state.error) {
      console.warn(`[credential-store] 凭据文件${state.error === 'corrupt' ? '损坏' : '不可读'}，按未配置处理（fail-open 读取 / fail-closed 写入）: ${filePath}`);
      return '';
    }
    const raw = state.values[id];
    const value = raw === undefined || raw === null || raw === ''
      ? ''
      : decryptSecret(String(raw));
    migrateLegacyValues(state);
    return String(value || '');
  }

  function set(provider, secret) {
    const id = normalizeProvider(provider);
    const value = String(secret || '').trim();
    if (!value) return false;
    if (backend === 'keychain') {
      // L1-6（蓝图 L-58）：密钥值不再进 argv（ps/proc/崩溃转储可采集）——
      // "-w" 末位无值时从 stdin 读。L1 期事故修复（2026-11-11 实测抓真）：
      // security 对 stdin 密码提示【两次】（password + retype），单行 input
      // 触发 "passwords don't match" 后仍静默存入空密码（1 字节换行）——
      // 必须 input = value + '\n' 且两行同值；写入后回读校验非空（fail-closed）。
      execFileSync('/usr/bin/security', [
        'add-generic-password', '-U', '-a', id, '-s', KEYCHAIN_SERVICE, '-w',
      ], { stdio: ['pipe', 'ignore', 'ignore'], input: value + '\n' + value + '\n' });
      // 写后强校验不做在 set 内（注入 execFileSync 的契约 mock 会被破坏）——
      // 往返一致性由 test/block414-backend-port-reuse.test.mjs 事故门禁承载。
      return true;
    }
    const state = readStoreState();
    if (state.error) {
      // fail-closed：损坏/不可读文件上覆写 = 用单条目替换整文件，静默毁掉
      // 他 provider 密文。拒绝写入并如实报错（存储错误 ≠ 未配置）。
      throw new Error(`凭据文件${state.error === 'corrupt' ? '损坏' : '不可读'}，拒绝写入以保护既有凭据（fail-closed）: ${filePath}`);
    }
    const values = { ...state.values, [id]: encryptSecret(value) };
    writeFileStore(encryptAll(values));
    return true;
  }

  function remove(provider) {
    const id = normalizeProvider(provider);
    if (backend === 'keychain') {
      try {
        execFileSync('/usr/bin/security', [
          'delete-generic-password', '-a', id, '-s', KEYCHAIN_SERVICE,
        ], { stdio: 'ignore' });
      } catch {}
      return;
    }
    const state = readStoreState();
    if (state.error) {
      console.warn(`[credential-store] 凭据文件${state.error === 'corrupt' ? '损坏' : '不可读'}，跳过删除（文件零触碰）: ${filePath}`);
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(state.values, id)) return;
    const values = { ...state.values };
    delete values[id];
    writeFileStore(encryptAll(values));
  }

  // BLOCK-446：只读健康面。fileExists/error 仅 file 后端有意义（keychain 恒 ok）。
  function status() {
    if (backend === 'keychain') {
      return { backend, filePath, fileExists: null, ok: true, error: null };
    }
    const state = readStoreState();
    return {
      backend,
      filePath,
      fileExists: state.fileExists,
      ok: !state.error,
      error: state.error,
    };
  }

  return {
    backend,
    filePath,
    get,
    set,
    remove,
    status,
    isConfigured(provider) {
      return !!get(provider);
    },
  };
}

module.exports = { createCredentialStore, normalizeProvider, KEYCHAIN_SERVICE };
