/**
 * owner msg_01cdf649141d 终裁：凭据后端统一 file（面板读写与插件自调用同链）。
 * HK-01：默认 backend=file、不依赖 macOS keychain、ai-credentials 0600 仓库外。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const store = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/credential-store.js'), 'utf8');

test('HK-01-1：credential-store 默认 file（不再按 darwin 自动 keychain）', () => {
  const at = store.indexOf('const backend =');
  const block = store.slice(at, at + 220);
  assert.match(block, /\|\|\s*'file'/);
  assert.doesNotMatch(block, /platform === 'darwin' \? 'keychain'/);
});

test('HK-01-2：env PETRI_CREDENTIAL_BACKEND 仍可显式覆盖（运维逃生口）', () => {
  assert.match(store, /process\.env\.PETRI_CREDENTIAL_BACKEND/);
});

test('HK-01-3：file backend 写 ai-credentials.json 0600', () => {
  assert.match(store, /mode:\s*0o600/);
  assert.match(store, /ai-credentials\.json/);
});
