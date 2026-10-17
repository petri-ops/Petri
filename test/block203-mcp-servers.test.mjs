/**
 * BLOCK-203 W4a P5 — `mcp-servers` 集合型落点收编契约测。
 *
 * 钉四件事：
 *  ① **形状复用 P4 的集合实现**：条目字段 `<item>.` 精确寻址，未知字段 fail-closed（`unknown_field`）；
 *     `env` 是动态命名空间，按 `object` **整体透传**（不会被拆成未知字段）。
 *  ② **上限单源**：条目数上限 = 族声明 `maxItems`；`args` 条数上限 = 字段 `domain.maxItems`。
 *  ③ **凭据边界（D-2）**：env 落盘是密文、读回是明文，但**导出主动剥离 env**；
 *     导入带 env 一律拒、按 id 自动保留原 env——"导出→导入"不得静默清空用户凭据。
 *  ④ **既有契约不破**：错误码 `invalid_id` / `missing_command` / `http_url_required` /
 *     `too_many_args` / `too_many_servers` / `duplicate_id` 逐字保持（路由与前端都认）。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b203-mcp-settings-'));
process.env.PETRI_LOCAL_DATA_DIR = tmpDir;

const settings = require(path.join(ROOT, 'core/petri-server/helpers/mcp-settings.js'));
const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));

test('BLOCK-203 P5 — 形状：未知字段 fail-closed，既有错误码逐字保持', () => {
  assert.equal(settings.normalizeServerEntry({ id: 'a', command: 'x', junk: 1 }).error, 'unknown_field');
  assert.equal(settings.normalizeServerEntry({ id: 'a b', command: 'x' }).error, 'invalid_id');
  assert.equal(settings.normalizeServerEntry({ id: 'a/b', command: 'x' }).error, 'invalid_id');
  assert.equal(settings.normalizeServerEntry({ id: 'ok' }).error, 'missing_command');
  assert.equal(settings.normalizeServerEntry({ id: 'ok', command: '   ' }).error, 'missing_command');
  assert.equal(settings.normalizeServerEntry({ id: 'ok', command: 'x', transport: 'http' }).error, 'http_url_required');
  assert.equal(settings.normalizeServerEntry({ id: 'ok', command: 'x', transport: 'http', url: 'ftp://x' }).error, 'invalid_entry');
  // 合法条目仍做现状清洗：trim、丢空 arg、只留字符串 env；stdio 时 url 被丢弃
  const { server } = settings.normalizeServerEntry({
    id: ' ok ', command: ' npx ', args: ['-y', '', 'x'], env: { A: 'a', B: 2 }, autoConnect: false, url: 'http://x',
  });
  assert.deepEqual(server, {
    id: 'ok', command: 'npx', args: ['-y', 'x'], env: { A: 'a' }, autoConnect: false, transport: 'stdio',
  });
});

test('BLOCK-203 P5 — 上限单源：条目数取族 maxItems，args 取字段 domain.maxItems', () => {
  assert.equal(schema.CONFIG_FAMILIES['mcp-servers'].maxItems, 50);
  assert.equal(schema.findItemFieldEntry('mcp-servers', 'args').domain.maxItems, 64);

  const tooManyArgs = settings.normalizeServerEntry({ id: 'a', command: 'x', args: Array.from({ length: 65 }, (_, i) => `a${i}`) });
  assert.equal(tooManyArgs.error, 'too_many_args');

  const many = Array.from({ length: 51 }, (_, i) => ({ id: `s${i}`, command: 'x' }));
  assert.equal(settings.saveMcpServers(many).error, 'too_many_servers');
});

test('BLOCK-203 P5 — env 落盘密文 / 读回明文；env 不拆成未知字段', () => {
  const saved = settings.saveMcpServers([{ id: 'crypto', command: 'node', env: { TOKEN: 'sk-secret' } }]);
  assert.equal(saved.error, undefined);
  const onDisk = JSON.parse(fs.readFileSync(settings.SETTINGS_FILE, 'utf8'));
  const persisted = onDisk.servers.find((s) => s.id === 'crypto');
  assert.match(persisted.env.TOKEN, /^enc:v1:/, '落盘必须是密文');
  const listed = settings.listMcpServers().find((s) => s.id === 'crypto');
  assert.equal(listed.env.TOKEN, 'sk-secret', '读回必须是明文');
  // doctor 的诊断路径用同一份判据：密文 env 不得被报成未知字段
  assert.deepEqual(schema.diagnoseItem('mcp-servers', persisted), []);
});

test('BLOCK-203 P5 — D-2：导出剥离 env；导入带 env 被拒；导入按 id 保留原 env', () => {
  settings.saveMcpServers([{ id: 'keepme', command: 'node', env: { TOKEN: 'sk-secret' } }]);
  const exported = settings.listMcpServersForExport();
  assert.equal(exported.find((s) => s.id === 'keepme').env, undefined, '导出不得带 env（凭据不随配置迁移）');

  const { validateImport, importConfig, exportConfig } = require(path.join(ROOT, 'core/petri-server/helpers/config-transfer.js'));
  const envelope = (families) => ({ format: 'petri-config', version: 1, families });

  const withEnv = validateImport(envelope({ 'mcp-servers': { servers: [{ id: 'keepme', command: 'node', env: { TOKEN: 'plain' } }] } }));
  assert.equal(withEnv.ok, false);
  assert.ok(withEnv.diagnostics.some((d) => d.path === 'servers[0].env' && d.code === 'not-allowed'));

  const noEnv = envelope({ 'mcp-servers': { servers: [{ id: 'keepme', command: 'node', args: ['x.js'] }] } });
  assert.equal(validateImport(noEnv).ok, true, `剥离 env 的导出必须能原样导回：${JSON.stringify(validateImport(noEnv).diagnostics)}`);

  const applied = importConfig(noEnv);
  assert.equal(applied.ok, true);
  const afterImport = settings.listMcpServers().find((s) => s.id === 'keepme');
  assert.equal(afterImport.env.TOKEN, 'sk-secret', '导入不得清空已有 env（按 id 保留）');
  assert.deepEqual(afterImport.args, ['x.js']);

  // 导出信封里不含任何 env，也不含明文凭据
  const serialized = JSON.stringify(exportConfig({ env: {} }));
  assert.ok(!serialized.includes('sk-secret'));
  assert.equal(JSON.parse(serialized).families['mcp-servers'].servers.find((s) => s.id === 'keepme').env, undefined);
});

test('BLOCK-203 P5 — 读侧 fail-open：损坏文件=空清单（不抛）', () => {
  fs.writeFileSync(settings.SETTINGS_FILE, '{not json', 'utf8');
  assert.deepEqual(settings.listMcpServers(), []);
  // 恢复干净状态，避免后续测试读到脏文件
  fs.writeFileSync(settings.SETTINGS_FILE, JSON.stringify({ version: 1, servers: [] }), 'utf8');
});

test('BLOCK-203 P5 — 注册面：9 键、无 env 层、条目字段不含逐 env 键', () => {
  const keys = schema.CONFIG_KEYS.filter((e) => e.family === 'mcp-servers');
  assert.deepEqual(keys.map((e) => e.path).sort(), [
    '<item>.args', '<item>.autoConnect', '<item>.command', '<item>.env', '<item>.id',
    '<item>.transport', '<item>.url', 'savedAt', 'version',
  ]);
  assert.deepEqual(schema.CONFIG_FAMILIES['mcp-servers'].precedence, ['file', 'default']);
  assert.equal(schema.findKeyEntry('mcpServers.version').owner, 'code');
});
