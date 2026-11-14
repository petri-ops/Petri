import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('BLOCK-447 后端：MCP 结果保留 _meta.ui.resourceUri 并透传 ui', () => {
  const src = read('core/petri-server/agent-tools/mcp-projection.js');
  assert.match(src, /called\.result\._meta/);
  assert.match(src, /metaUi\.resourceUri/);
  assert.match(src, /\{\s*serverId,\s*uri:\s*metaUi\.resourceUri\s*\}/);
  assert.match(src, /\.\.\.\(ui \? \{ ui \} : \{\}\)/);
});

test('BLOCK-447 后端：MCP App 页面内工具调用路由在场（缺 toolName 400）', () => {
  const src = read('core/petri-server/routes/mcp-client.js');
  assert.match(src, /app\.post\('\/api\/mcp\/servers\/:id\/tools\/call'/);
  assert.match(src, /tool_name_required/);
  assert.match(src, /manager\.callServerTool\(id, toolName, args\)/);
});

test('BLOCK-447 主进程：callTool 只认 session 绑定的 server，拒绝伪造 session', () => {
  const src = read('src/ipc/gen-ui.js');
  assert.match(src, /callMcpAppToolGenUi/);
  assert.match(src, /ownerWebContentsId !== event\.sender\.id/);
  assert.match(src, /String\(session\.scopeKey\)\.slice\('mcp-app:'\.length\)/);
  assert.match(src, /session_not_found/);
  // 只在 callMcpAppToolGenUi 函数体内断言「不信任渲染层传来的 serverId」；
  // 同文件的 prepareMcpAppGenUi 合法使用 payload.serverId，不能整文件禁用。
  const fnStart = src.indexOf('async function callMcpAppToolGenUi');
  const fnEnd = src.indexOf('function setupGenUiIpc()', fnStart);
  assert.ok(fnStart > 0 && fnEnd > fnStart);
  assert.doesNotMatch(src.slice(fnStart, fnEnd), /payload\.serverId/);
});

test('BLOCK-447 通道/preload/沙箱桥：四个新契约同批登记', () => {
  assert.match(read('src/ipc/channels.js'), /callMcpAppTool: 'gen-ui:mcp-app-call'/);
  assert.match(read('src/preload.js'), /callMcpAppTool: \(payload\)/);
  assert.match(read('src/main/gen-ui/guest-bridge.js'), /petri\/mcp-app\/call-tool/);
  assert.match(read('frontend/src/lib/electron.d.ts'), /callMcpAppTool: \(payload/);
});

test('BLOCK-447 前端：工具结果自动挂 MCP App 卡片，桥 API 由组件消费', () => {
  const activity = read('frontend/src/components/copilot/toolActivity.ts');
  assert.match(activity, /parseMcpAppFromResult/);
  assert.match(activity, /mcpApp: parseMcpAppFromResult/);
  const list = read('frontend/src/components/copilot/ToolActivityList.tsx');
  assert.match(list, /<McpAppCard app=\{activity\.mcpApp\}/);
  const card = read('frontend/src/components/copilot/gen-ui/McpAppCard.tsx');
  assert.match(card, /prepareMcpApp/);
  assert.match(card, /callMcpAppTool/);
  assert.match(card, /event\.origin !== sandbox\.origin/);
  assert.match(card, /allow-scripts allow-same-origin/);
});
