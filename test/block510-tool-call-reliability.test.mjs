import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// 临时 DB 自举（同 agent-approval.test 修法：registry require 链带 db.js，
// PETRI_DB_PATH 须在 require 前生效；单跑/全量缺 projects 表问题一并规避）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const req = createRequire(import.meta.url);
{
  const osx = req('node:os');
  const Database = req(path.resolve(__dirname, '..', 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const tempDbDir = fs.mkdtempSync(path.join(osx.tmpdir(), 'petri-block510-db-'));
  const boot = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
}

const { createAgentToolInterceptor } = req(path.resolve(__dirname, '..', 'core/petri-server/agent-tools/agent-tool-interceptor.js'));
const { listBuiltinToolNames } = req(path.resolve(__dirname, '..', 'core/petri-server/agent-tools/registry.js'));

// BLOCK-510 — 工具调用可靠性三件（用户实证三错误：exec→unknown_tool / `set -e cmd` 静默跳过 / 自建封装脚本链式崩）：
// P1a unknown_tool 相近名建议（模型一次自我纠正）
// P1b workspace_exec description 平台/shell 语义补强（模型可见面）
// P1c exec 失败反馈 set -e pitfall hint（同 attachCommandNotFoundHint 先例）

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('P1a — unknown_tool 附相近已注册工具建议（exec → workspace_exec）', async () => {
  const interceptor = createAgentToolInterceptor();
  const r = await interceptor('exec', {}, {}, {});
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unknown_tool');
  assert.deepEqual(r.suggestions, ['workspace_exec', 'workspace_exec_background'],
    `exec 的建议应为 workspace_exec 族，实际: ${JSON.stringify(r.suggestions)}`);
  assert.match(r.message, /相近已注册工具: workspace_exec/);
});

test('P1a — 前缀/编辑距离兜底：workspace_exe 仍命中建议；正常工具不受影响', async () => {
  const interceptor = createAgentToolInterceptor();
  const r = await interceptor('workspace_exe', {}, {}, {});
  assert.ok((r.suggestions || []).includes('workspace_exec'), `workspace_exe 建议应含 workspace_exec: ${JSON.stringify(r.suggestions)}`);
  assert.match(r.message, /相近已注册工具/);
  // 注入覆盖点仍然生效（options.suggestToolNames 优先）
  const injected = createAgentToolInterceptor({ suggestToolNames: () => ['custom_tool'] });
  const r2 = await injected('nope', {}, {}, {});
  assert.deepEqual(r2.suggestions, ['custom_tool']);
  // 真实已注册工具走正常路径（entry 在场，不产生 suggestions）
  const names = listBuiltinToolNames();
  assert.ok(names.length > 20, `注册表应有充足内建工具: ${names.length}`);
  assert.ok(names.includes('workspace_exec'));
});

test('P1b — workspace_exec description 平台/shell 语义补强（provider-visible）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/tool-defs/workspace.js'), 'utf8');
  const m = src.match(/"name": "workspace_exec"[\s\S]*?"description": "([^"]+)"/);
  assert.ok(m, 'workspace_exec def 应在 tool-defs/workspace.js');
  const desc = m[1];
  assert.match(desc, /system_info/, '应含平台确认指引（先 system_info）');
  assert.match(desc, /set -e/, '应含 set -e 误区警示');
  assert.match(desc, /Windows 默认 cmd/, '应含平台 shell 默认说明');
  assert.match(desc, /先单独跑通脚本/, '应含自建封装脚本小步验证指引');
});

test('P1c — 失败反馈 set -e pitfall hint（源级断言：两处失败路径均挂 hint）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/workspace-tools.js'), 'utf8');
  assert.match(src, /function attachShellSemanticsHint\(result\)/, 'hint helper 应在场');
  assert.match(src, /set -e 后跟命令名不会执行该命令/, 'hint 文案应解释 set 位置参数语义');
  const calls = src.match(/attachShellSemanticsHint\(/g) || [];
  assert.ok(calls.length >= 3, `hint 应在同步+yield 两处失败路径调用（定义1+调用≥2），实际 ${calls.length}`);
  assert.match(src, /attachShellSemanticsHint\(failed\)/);
  assert.match(src, /attachShellSemanticsHint\(result\)/);
});
