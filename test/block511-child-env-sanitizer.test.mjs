/**
 * BLOCK-511 S3.1c HK-01 — 子进程环境剥离三例。
 * ①凭据类变量全部剥除；②其余环境原样透传（无白名单）；③连接日志只写变量名不写值。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { sanitizeChildEnv } = await import(pathToFileURL(path.join(root, 'core/shared-backend/child-env-sanitizer.js')).href);

test('①凭据类变量全部剥除（精确 + 名称含关键字，大小写不敏感）', () => {
  const input = {
    PETRI_LOCAL_REQUEST_TOKEN: 'local-secret',
    GITHUB_TOKEN: 'ghp-xxx',
    MY_API_KEY: 'key-xxx',
    db_password: 'pw',
    AWS_SECRET_ACCESS_KEY: 'secret',
    PRIVATE_KEY_PATH: '/tmp/key',
    CREDENTIAL_FILE: '/tmp/cred',
    SESSION_KEY: 'sess',
    ACCESS_KEY_ID: 'akid',
    PASSWD: 'pw2',
  };
  const { env, stripped } = sanitizeChildEnv(input);
  assert.deepEqual(Object.keys(env), []);
  for (const k of Object.keys(input)) assert.ok(stripped.includes(k), `${k} 应被剥除`);
  for (const k of stripped) assert.ok(!JSON.stringify(env).includes(input[k]), '值不得出现在透传环境');
});

test('②其余环境原样透传（无白名单，避免打断用户 MCP 服务器依赖）', () => {
  const input = {
    PATH: '/usr/bin',
    HOME: '/home/u',
    MY_CUSTOM_VAR: 'keep-me',
    PETRI_DATA_DIR: '/data',
    NODE_OPTIONS: '--max-old-space-size=512',
    CSRF_TOKEN_LIKE_TEXT: 'benign-value', // 名称含 TOKEN → 按规则剥除（保守）
  };
  const { env, stripped } = sanitizeChildEnv(input);
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/u');
  assert.equal(env.MY_CUSTOM_VAR, 'keep-me');
  assert.equal(env.PETRI_DATA_DIR, '/data');
  assert.equal(env.NODE_OPTIONS, '--max-old-space-size=512');
  assert.ok(stripped.includes('CSRF_TOKEN_LIKE_TEXT'));
});

test('③日志只写被剥除的变量名（不含值）', () => {
  const input = { GITHUB_TOKEN: 'super-secret-value-xyz', KEEP: 'ok' };
  const { env, stripped } = sanitizeChildEnv(input);
  const logLine = `[mcp] stripped env keys: ${stripped.join(', ')}`;
  assert.match(logLine, /GITHUB_TOKEN/);
  assert.ok(!logLine.includes('super-secret-value-xyz'), '日志不得含 token 值');
  assert.equal(env.KEEP, 'ok');
});
