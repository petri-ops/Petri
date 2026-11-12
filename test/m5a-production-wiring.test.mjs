/**
 * BLOCK-434 · M5 判据层→生产路径接线（W1–W4）
 * HK-01 负测：每项都断言「判据真的被生产路径调用」，并含篡改必红边界。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

test('W1 secret-scan：git grep 真实故障必须 fail-closed（不当作无命中）', () => {
  const { adjudicateGitGrepResult } = require(
    path.join(ROOT, 'core/petri-server/agent-tools/security-boundaries.js'),
  );
  assert.equal(adjudicateGitGrepResult({ exitCode: 0 }).status, 'matched');
  assert.equal(adjudicateGitGrepResult({ exitCode: 1 }).status, 'no-match');
  // ENOENT / 128 / 超时 → 必须 fail-closed
  for (const code of [128, -1, null, undefined, 'ENOENT']) {
    assert.equal(adjudicateGitGrepResult({ exitCode: code }).status, 'fail-closed');
  }
  assert.equal(adjudicateGitGrepResult({ exitCode: 1, stderr: 'fatal: not a git repository' }).status, 'fail-closed');
});

test('W1 secret-scan：脚本已消费判据（源码锚点）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/secret-scan.mjs'), 'utf8');
  assert.match(src, /adjudicateGitGrepResult/);
  assert.doesNotMatch(src, /catch\s*\{\s*continue;?\s*\}/);
});

test('W2 全局 Origin 门：有 Origin 且不可信 → 403；无 Origin → 放行（既有语义不变）', () => {
  const { rejectUntrustedOrigin } = require(path.join(ROOT, 'core/petri-server/bootstrap.js'));
  assert.equal(typeof rejectUntrustedOrigin, 'function');

  const makeRes = () => {
    const state = { code: 200, body: null };
    return {
      state,
      status(code) { state.code = code; return this; },
      json(body) { state.body = body; return this; },
    };
  };

  // 无 Origin：放行（curl / 本地脚本 / 既有测试）
  let nexted = false;
  rejectUntrustedOrigin({ headers: {}, method: 'POST' }, makeRes(), () => { nexted = true; });
  assert.equal(nexted, true);

  // 可信桌面 Origin：放行
  nexted = false;
  rejectUntrustedOrigin(
    { headers: { origin: 'http://localhost:3000' }, method: 'POST' },
    makeRes(), () => { nexted = true; },
  );
  assert.equal(nexted, true);

  // 不可信 http(s) Origin（外部站点）：403 + 结构化错误
  nexted = false;
  const res = makeRes();
  rejectUntrustedOrigin({ headers: { origin: 'https://evil.example.com' }, method: 'POST' }, res, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(res.state.code, 403);
  assert.equal(res.state.body.error, 'untrusted_origin');

  // 不可信回环端口（非白名单）：403
  const res2 = makeRes();
  rejectUntrustedOrigin({ headers: { origin: 'http://localhost:6666' }, method: 'GET' }, res2, () => {});
  assert.equal(res2.state.code, 403);

  // Origin:'null'（file:// 拖出下载）+ 路由级 token 门：全局门不拦，语义交给路由
  nexted = false;
  rejectUntrustedOrigin({ headers: { origin: 'null' }, method: 'GET' }, makeRes(), () => { nexted = true; });
  assert.equal(nexted, true);
});

test('W2 全局门已挂载到 bootstrap（非仅 files 路由）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/bootstrap.js'), 'utf8');
  assert.match(src, /app\.use\(rejectUntrustedOrigin\)/);
});

test('W3 DDL 迁移：预期内已存在 → 记为 suppressed，非预期失败 → 结构化 error，且不抛', () => {
  const { applyDdlStatements } = require(path.join(ROOT, 'core/petri-server/helpers/ddl-migrate.js'));
  assert.equal(typeof applyDdlStatements, 'function');

  const calls = [];
  const exec = (sql) => {
    calls.push(sql);
    if (sql.includes('BOOM')) {
      const err = new Error('disk I/O error');
      throw err;
    }
    if (sql.includes('DUP')) {
      const err = new Error('duplicate column name: project_id');
      throw err;
    }
  };

  const result = applyDdlStatements({
    exec,
    statements: [
      { sql: 'ALTER TABLE t ADD COLUMN project_id TEXT', operation: 'add_user_facts_project_id' },
      { sql: 'ALTER TABLE t ADD COLUMN DUP TEXT', operation: 'duplicate_column_case' },
      { sql: 'ALTER TABLE t ADD COLUMN BOOM TEXT', operation: 'real_failure_case' },
    ],
  });

  assert.equal(calls.length, 3);
  assert.equal(result.applied, 1);
  assert.equal(result.suppressed, 1);
  assert.equal(result.failed, 1);
  const failed = result.issues.find((i) => i.operation === 'real_failure_case');
  assert.equal(failed.code, 'DDL_FAILED');
  assert.equal(failed.severity, 'error');
  const suppressed = result.issues.find((i) => i.operation === 'duplicate_column_case');
  assert.equal(suppressed.code, 'DDL_FAILED_SILENTLY');
  assert.equal(suppressed.severity, 'info');
});

test('W3 ai-memory 已接入结构化 DDL（源码锚点，四处裸 catch 清零）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/routes/ai-memory.js'), 'utf8');
  assert.match(src, /ddl-migrate/);
  assert.doesNotMatch(src, /try \{ sqlite\.exec\('[^']*'\); \} catch \{\}/);
});

test('W4 zip 解压失败清理半成品目录，且原始错误不被掩盖', async () => {
  const { extractZipFile } = require(path.join(ROOT, 'src/plugin/zip.js'));
  assert.equal(typeof extractZipFile, 'function');

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-zip-w4-'));
  const badZip = path.join(tmpRoot, 'not-a-zip.zip');
  const destDir = path.join(tmpRoot, 'dest');
  fs.writeFileSync(badZip, 'this is definitely not a zip archive');

  let thrown = null;
  try {
    await extractZipFile(badZip, destDir);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, '非法 zip 必须抛错');
  assert.equal(fs.existsSync(destDir), false, '失败后必须清理半成品 destDir');
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('W4 成功解压不误删目录（清理只在失败分支）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/plugin/zip.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function extractZipFile'));
  assert.match(fn, /catch[\s\S]*rmSync|rmSync[\s\S]*catch/);
  assert.match(src, /throw/);
});

test('W5 MCP stdio 接线：注入硬化恒生效，命令白名单按显式 env 生效（默认不改产品能力面）', () => {
  const { adjudicateStdioConfig } = require(path.join(ROOT, 'core/petri-server/mcp/client-manager.js'));
  assert.equal(typeof adjudicateStdioConfig, 'function');

  // ① 注入硬化：命令/参数含 shell 元字符必红（无论是否配置白名单）
  assert.equal(
    adjudicateStdioConfig({ command: 'node', args: ['a; rm -rf /'] }).reasonCode,
    'MCP_ARGS_SHELL_METACHAR',
  );
  assert.equal(
    adjudicateStdioConfig({ command: 'node', args: ['`whoami`'], allowlistEnv: 'node' }).reasonCode,
    'MCP_ARGS_SHELL_METACHAR',
  );

  // ② 未设置 env：任意命令保持可用（回归面——生态里 uvx/bun/docker 等属正常配置）
  assert.equal(adjudicateStdioConfig({ command: 'node', args: ['server.js'] }).ok, true);
  assert.equal(adjudicateStdioConfig({ command: '/usr/local/bin/uvx', args: [] }).ok, true);

  // ③ 显式设置 env：按清单 fail-closed
  assert.equal(
    adjudicateStdioConfig({ command: 'uvx', args: [], allowlistEnv: 'node,npx,python3' }).reasonCode,
    'MCP_COMMAND_NOT_ALLOWLISTED',
  );
  assert.equal(adjudicateStdioConfig({ command: 'npx', args: [], allowlistEnv: 'node,npx,python3' }).ok, true);
});

test('W5 spawn 点已消费判据（源码锚点：真实入口是 mcp/client-manager.js 而非 routes/mcp-client.js）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/mcp/client-manager.js'), 'utf8');
  assert.match(src, /adjudicateStdioConfig/);
  assert.match(src, /mcp_command_rejected/);
  const spawnIdx = src.indexOf('new StdioClientTransport');
  const gateIdx = src.indexOf('adjudicateStdioConfig({');
  assert.ok(gateIdx > 0 && spawnIdx > 0 && gateIdx < spawnIdx, '判据必须在 spawn 之前');
});

test('W6 子框导航分级：genui/trusted/hijack/other 四类，userinfo 必红', () => {
  const { classifySubframeNavigation } = require(path.join(ROOT, 'src/main/subframe-navigation.js'));
  assert.equal(typeof classifySubframeNavigation, 'function');
  assert.equal(classifySubframeNavigation('petri-genui://card/1').kind, 'genui');
  assert.equal(classifySubframeNavigation('http://localhost:3000/x').kind, 'trusted');
  assert.equal(classifySubframeNavigation('https://evil.example.com/x').kind, 'hijack');
  assert.equal(classifySubframeNavigation('https://evil.example.com/x').reasonCode, 'FRAME_ORIGIN_NOT_ALLOWLISTED');
  assert.equal(classifySubframeNavigation('http://u:p@localhost:3000/x').reasonCode, 'USERINFO_FORBIDDEN');
  assert.equal(classifySubframeNavigation('about:blank').kind, 'other');
  assert.equal(classifySubframeNavigation('null').kind, 'other');
});

test('W6 侦测路已消费判据（不再只依赖登记表命中）', () => {
  const hook = fs.readFileSync(path.join(ROOT, 'src/main/security-hardening.js'), 'utf8');
  assert.match(hook, /classifySubframeNavigation\(urlText\)/);
  assert.match(hook, /verdict\.kind === 'hijack' && !hit/);
  const judge = fs.readFileSync(path.join(ROOT, 'src/main/subframe-navigation.js'), 'utf8');
  assert.match(judge, /adjudicateFrameNavigation/);
  // 不假装能拦：必须保留「preventDefault 对子框导航无效」的事实说明
  assert.match(judge, /preventDefault`?\s*对子框导航无效/);
});

test('W3 实测补充：表尚未创建（no such table）属预期，不记 error（避免启动假告警）', () => {
  const { applyDdlStatements } = require(path.join(ROOT, 'core/petri-server/helpers/ddl-migrate.js'));
  const exec = (sql) => {
    if (sql.includes('MISSING')) {
      const err = new Error('no such table: user_facts');
      throw err;
    }
    if (sql.includes('BOOM')) throw new Error('disk I/O error');
  };
  const result = applyDdlStatements({
    quiet: true,
    exec,
    statements: [
      { sql: 'ALTER TABLE MISSING ADD COLUMN project_id TEXT', operation: 'table_not_yet_created' },
      { sql: 'ALTER TABLE BOOM ADD COLUMN x TEXT', operation: 'real_io_failure' },
    ],
  });
  const pending = result.issues.find((i) => i.operation === 'table_not_yet_created');
  assert.equal(pending.code, 'DDL_FAILED_SILENTLY');
  assert.equal(pending.severity, 'info', '表未创建不得记 error');
  assert.equal(result.suppressed, 1);
  assert.equal(result.failed, 1);
  const real = result.issues.find((i) => i.operation === 'real_io_failure');
  assert.equal(real.severity, 'error', '真实 IO 故障仍须 error');
});

test('W7 导入源范围判据：允许根命中/越界/设备路径/NUL/相对/缺失/星号放开', () => {
  const S = require(path.join(ROOT, 'core/petri-server/agent-tools/security-boundaries.js'));
  const A = S.adjudicateDragSource;
  const roots = ['/Users/me', '/tmp'];
  assert.equal(A({ localPath: '/Users/me/a.png', realpath: '/Users/me/a.png', allowedRoots: roots }).ok, true);
  assert.equal(A({ localPath: '/etc/hosts', realpath: '/etc/hosts', allowedRoots: roots }).reasonCode, 'DRAG_SOURCE_OUTSIDE_ALLOWED_ROOTS');
  // 符号链接逃逸：入参看似在根内，realpath 落在根外 → 必红
  assert.equal(A({ localPath: '/Users/me/link', realpath: '/etc/passwd', allowedRoots: roots }).reasonCode, 'DRAG_SOURCE_OUTSIDE_ALLOWED_ROOTS');
  assert.equal(A({ localPath: '/dev/disk0', realpath: '/dev/disk0', allowedRoots: roots }).reasonCode, 'DRAG_SOURCE_DEVICE_PATH');
  assert.equal(A({ localPath: `/tmp/a${String.fromCharCode(0)}b`, allowedRoots: roots }).reasonCode, 'DRAG_SOURCE_NUL_BYTE');
  assert.equal(A({ localPath: 'rel/a', allowedRoots: roots }).reasonCode, 'DRAG_SOURCE_NOT_ABSOLUTE');
  assert.equal(A({ localPath: '/tmp/x', exists: false, allowedRoots: roots }).reasonCode, 'DRAG_SOURCE_MISSING');
  assert.equal(A({ localPath: '/etc/hosts', realpath: '/etc/hosts', allowedRoots: ['*'] }).ok, true);
});

test('W7 fs/import-from 已消费源范围判据（含允许根 realpath 归一与 /tmp 纳入）', () => {
  const route = fs.readFileSync(path.join(ROOT, 'core/petri-server/routes/files.js'), 'utf8');
  const roots = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/drag-source-roots.js'), 'utf8');
  // 路由侧：调用组合判据，且在 cp 之前
  assert.match(route, /adjudicateImportSource/);
  assert.match(route, /fs\.promises\.realpath\(sourceAbsolutePath\)/);
  const gateIdx = route.indexOf('adjudicateImportSource({');
  const cpIdx = route.indexOf('fs.promises.cp(sourceAbsolutePath');
  assert.ok(gateIdx > 0 && cpIdx > 0 && gateIdx < cpIdx, '源范围判定必须在拷贝之前');
  // 策略侧：realpath 归一 + /tmp 纳入 + 判据单源
  assert.match(roots, /adjudicateDragSource/);
  assert.match(roots, /realpathSync\(root\)/);
  assert.match(roots, /'\/tmp'/);
  assert.match(roots, /PETRI_DRAG_SOURCE_ROOTS/);
});
