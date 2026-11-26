/**
 * conv_99208eb5-6b7 回归 HK-01：今日内置创作包把 generate.image/video/model3d 加进
 * TOOL_DEFS，但 OpenAI 兼容 provider 要求 function.name 匹配 ^[a-zA-Z0-9_-]+$，
 * 点号导致每次 agent run 在请求组装期 400（http_error / agent_run_failed）。
 * 断言：provider 投影名全合法 + 可逆映射回内核规范名。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// registry 加载期需要 DB：自举临时库（同 generate-builtin-tools）。
{
  const os = require_('node:os');
  const Database = require_(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-name-db-'));
  const boot = new Database(path.join(dir, 'petri.db'));
  const migrations = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrations, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(dir, 'petri.db');
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
}

const registry = require_(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'registry.js'));

test('HK-01-1：provider 投影的每个工具名匹配 ^[a-zA-Z0-9_-]+$', () => {
  const bad = registry.getProviderToolDefs()
    .map((d) => d && d.function && d.function.name)
    .filter((n) => typeof n !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(n));
  assert.deepEqual(bad, [], 'provider 工具名不得含点号等非法字符');
});

test('HK-01-2：generate.* 投影为 generate_* 且可逆映射回内核规范名', () => {
  const { toProviderToolName, fromProviderToolName } = registry;
  for (const name of ['generate.image', 'generate.video', 'generate.model3d']) {
    const projected = toProviderToolName(name);
    assert.match(projected, /^[a-zA-Z0-9_-]+$/);
    assert.equal(fromProviderToolName(projected), name);
    assert.equal(typeof registry.getToolHandler(fromProviderToolName(projected)), 'function');
  }
  // 存量合法名零变化
  assert.equal(toProviderToolName('workspace_write'), 'workspace_write');
  assert.equal(fromProviderToolName('workspace_write'), 'workspace_write');
});
