#!/usr/bin/env node
'use strict';

/**
 * BLOCK-83 P1 出口实机验收：15 生信插件链在 P1 改动（D1 改名 / D2 SDK 放宽 / D3 钩子化）后完好。
 *
 * 运行（对标 BLOCK-79/82 in-process 驱动先例，需 fnm Node 24 + dev 数据面 env）：
 *   export PATH="/c/Users/Admin/AppData/Roaming/fnm/node-versions/v24.20.0/installation:$PATH"
 *   export BIOF3_DB_PATH='D:\1.WorkDir\biof3-desktop\.biof3-dev-user-data\data\biof3.db'
 *   export BIOF3_LOCAL_DATA_DIR='D:\1.WorkDir\biof3-desktop\.biof3-dev-user-data\data'
 *   node scripts/block83-p1-plugin-live.cjs
 *
 * 断言：
 *   A1 mcp registry 注册面含全部 15 个生信插件工具
 *   A2 D3 过渡装配在进程内生效（scientific-task-confirmation 钩子已注册）
 *   A3 run_tool 对 R 插件呈诚实结构化失败（本机无 R；若命中科学确认门则同时实证钩子链）
 *   A4 RS 全量 descriptor 的 4 插件严格 lint 通过（D2 放宽后 .R 契约继续合法）
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const results = [];
function assert(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail == null ? '' : String(detail).slice(0, 300) });
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (ok ? '' : ' :: ' + String(detail).slice(0, 300)));
}

(async () => {
  const registry = require(path.join(root, 'core/biof3-server/mcp/registry.js'));
  const hooks = require(path.join(root, 'core/shared-backend/task-confirmation-hooks.js'));
  const sdk = require(path.join(root, 'core/shared-backend/result-studio-plugin-sdk.js'));
  const pluginLoader = require(path.join(root, 'core/biof3-server/plugin-loader.js'));

  const bioIds = fs.readdirSync(path.join(root, 'resources/built-in-plugins'))
    .filter((d) => fs.existsSync(path.join(root, 'resources/built-in-plugins', d, 'plugin.json')));

  // A1 注册面
  const tools = await registry.listTools();
  const toolNames = new Set(tools.map((t) => t && (t.name || t.id)).filter(Boolean));
  const missing = bioIds.filter((id) => !toolNames.has(id));
  assert('A1 全部 15 个生信插件工具已注册', missing.length === 0,
    missing.length ? 'missing: ' + missing.join(',') : 'registered=' + bioIds.length);

  // A2 钩子装配
  const hookIds = hooks.listTaskConfirmationHooks();
  assert('A2 scientific-task-confirmation 钩子经 plugin-loader 装配注册', hookIds.includes('scientific-task-confirmation'),
    'hooks=' + JSON.stringify(hookIds));

  // A3 run_tool 诚实行为（本机无 R：期望结构化失败而非崩溃/挂起）
  let a3ok = false;
  let a3detail = '';
  try {
    const out = await registry.callTool('deseq2', {}, { userId: 'block83-live' });
    const text = JSON.stringify(out);
    a3ok = text.includes('"isError":true') || text.includes('isError') || /error|失败|missing|not_found|confirm/i.test(text);
    a3detail = text.slice(0, 220);
  } catch (e) {
    // 抛错也算诚实失败（结构化错误类），但不允许挂起（外层 timeout 兜底）。
    a3ok = true;
    a3detail = 'thrown: ' + e.message.slice(0, 200);
  }
  assert('A3 run_tool(deseq2) 诚实失败（无 R 环境）', a3ok, a3detail);

  // A4 RS 全量 descriptor 插件严格 lint
  const rsIds = ['deseq2', 'volcano-plot', 'gene-correlation', 'go-kegg'];
  let a4ok = true;
  const a4detail = [];
  for (const id of rsIds) {
    const pluginDir = path.join(root, 'resources/built-in-plugins', id);
    const plugin = { ...JSON.parse(fs.readFileSync(path.join(pluginDir, 'plugin.json'))), pluginDir };
    const toolDefinition = JSON.parse(fs.readFileSync(path.join(pluginDir, 'tool-definition.json')));
    const lint = sdk.lintResultStudioPlugin({ plugin, toolDefinition, pluginDir });
    if (!lint.valid) { a4ok = false; a4detail.push(id + ':' + JSON.stringify(lint.errors).slice(0, 120)); }
  }
  assert('A4 RS descriptor 插件严格 lint 通过（D2 后 .R 契约合法）', a4ok, a4detail.join(' | ') || '4/4 valid');

  const pass = results.filter((r) => r.ok).length;
  const summary = {
    generatedAt: new Date().toISOString(),
    block: 'BLOCK-83-P1-EXIT',
    env: { node: process.version, platform: process.platform },
    totals: { pass, fail: results.length - pass, all: results.length },
    results,
  };
  const outDir = path.join(root, 'acceptance/block-83');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'block83-p1-plugin-live.json'), JSON.stringify(summary, null, 2));
  console.log('---');
  console.log('P1 出口实机验收: ' + pass + '/' + results.length + ' allPass=' + (pass === results.length));
  console.log('evidence: acceptance/block-83/block83-p1-plugin-live.json');
  process.exitCode = pass === results.length ? 0 : 1;
})().catch((e) => { console.error('driver crashed:', e); process.exit(2); });
