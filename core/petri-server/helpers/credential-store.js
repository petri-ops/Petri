/**
 * Local AI credential store.
 *
 * macOS uses the login Keychain. Other platforms use a separate 0600 file so
 * secrets never enter ai-settings.json, renderer snapshots, or diagnostics.
 */

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const KEYCHAIN_SERVICE = 'com.petri.desktop.ai';

function normalizeProvider(provider) {
  const value = String(provider || '').trim().toLowerCase();
  if (!value || !/^[a-z0-9._-]+$/.test(value)) {
    throw new Error(`无效的凭据 Provider: ${provider || '(empty)'}`);
  }
  return value.replace(/-vision$/, '');
}

function createCredentialStore(options = {}) {
  const platform = options.platform || process.platform;
  const settingsDir = options.settingsDir;
  if (!settingsDir) throw new Error('Credential store requires settingsDir');
  const execFileSync = options.execFileSync || childProcess.execFileSync;
  const backend = options.backend || process.env.PETRI_CREDENTIAL_BACKEND ||
    (platform === 'darwin' ? 'keychain' : 'file');
  const filePath = path.join(settingsDir, 'ai-credentials.json');

  function readFileStore() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
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
    return String(readFileStore()[id] || '');
  }

  function set(provider, secret) {
    const id = normalizeProvider(provider);
    const value = String(secret || '').trim();
    if (!value) return false;
    if (backend === 'keychain') {
      execFileSync('/usr/bin/security', [
        'add-generic-password', '-U', '-a', id, '-s', KEYCHAIN_SERVICE, '-w', value,
      ], { stdio: 'ignore' });
      return true;
    }
    const values = readFileStore();
    values[id] = value;
    writeFileStore(values);
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
    const values = readFileStore();
    if (!Object.prototype.hasOwnProperty.call(values, id)) return;
    delete values[id];
    writeFileStore(values);
  }

  return {
    backend,
    filePath,
    get,
    set,
    remove,
    isConfigured(provider) {
      return !!get(provider);
    },
  };
}

module.exports = { createCredentialStore, normalizeProvider, KEYCHAIN_SERVICE };
