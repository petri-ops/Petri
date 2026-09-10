#!/usr/bin/env node
'use strict';
// BLOCK-77 P1 — surface 驻留创建链加传输重试（一次性手术脚本，用后即删）。
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, '..', 'core', 'biof3-server', 'agent-tools', 'workspace-ssh-surface.js');
let t = fs.readFileSync(FILE, 'utf8');

// 0) 头部导入 withTransportRetry
const impAnchor = "const workspaceGateway = require('../helpers/workspace-gateway');";
if (!t.includes(impAnchor)) { console.error('import anchor missing'); process.exit(1); }
t = t.replace(
  impAnchor,
  impAnchor + "\n// BLOCK-77 P1 — 驻留创建链传输重试（dell 嵌套 ProxyJump 半死隧道实测：mux 首写 30s\n// 超时 → killSession 重建 → 重试即通；与直跑 runner 的 withTransportRetry 同款纪律）\nconst { withTransportRetry } = require('../helpers/remote-execution/ssh-direct-runner');",
);

// 1) exec_bg 起进程包重试
const oldS = [
  '    // ① 起进程：复用既有 exec_bg 通道（注册表/日志语义不变）',
  '    const bg = await execBackground({ command, cwd: args.cwd }, ctx);',
].join('\n');
const newS = [
  '    // ① 起进程：复用既有 exec_bg 通道（注册表/日志语义不变）+ 传输重试包裹',
  '    const bg = await withTransportRetry(() => execBackground({ command, cwd: args.cwd }, ctx));',
].join('\n');
if (!t.includes(oldS)) { console.error('S pattern missing'); process.exit(1); }
t = t.replace(oldS, newS);

// 2) mkdir/write 包重试
const oldW = [
  '    try {',
  '      await ws.backend.mkdir(dirAbs);',
  "      await ws.backend.write(`${dirAbs}/${taskId}.json`, Buffer.from(JSON.stringify(card, null, 2), 'utf8'));",
  '    } catch (e) {',
  "      return { ok: true, taskId, pid: bg.pid, logPath: bg.logFile, cardError: `意图卡写入失败: ${e.message}` };",
  '    }',
].join('\n');
const newW = [
  '    try {',
  '      await withTransportRetry(async () => {',
  '        await ws.backend.mkdir(dirAbs);',
  "        await ws.backend.write(`${dirAbs}/${taskId}.json`, Buffer.from(JSON.stringify(card, null, 2), 'utf8'));",
  '      });',
  '    } catch (e) {',
  "      return { ok: true, taskId, pid: bg.pid, logPath: bg.logFile, cardError: `意图卡写入失败: ${e.message}` };",
  '    }',
].join('\n');
if (!t.includes(oldW)) { console.error('W pattern missing'); process.exit(1); }
t = t.replace(oldW, newW);

fs.writeFileSync(FILE, t);
console.log('transport retry wired into resident create');
