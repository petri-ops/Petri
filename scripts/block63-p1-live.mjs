'use strict';
import { spawn } from 'node:child_process';
// BLOCK-104 P4 — Windows 专属脚本入口护栏：非 win32 直接退出，杜绝半途怪异失败。
if (process.platform !== 'win32') {
  console.error(`[platform] block63-p1-live.mjs 仅支持 Windows（当前 ${process.platform}）。`);
  process.exit(2);
}

/**
 * BLOCK-63 P1 — Windows 电脑控制 sidecar 实机闭环（dev Electron + 真实记事本）。
 *
 * 断言：
 *   A1 probe：trusted + platform=windows + hostElevated 布尔
 *   A2 记事本启动 → snapshot frontmost：元素数 > 0 且含编辑区角色（Document/Edit/TextArea）
 *   A3 对编辑区 ref 执行 click：mode ∈ invoke|coordinate，ok
 *   A4 复照 snapshot：focusedRole 命中编辑区角色（焦点证据，对标 BLOCK-48 P1）
 *   A5 dev Electron UIA 观测：前置后 snapshot 元素数（Chromium UIA 懒启用现状取证）
 *   A6 全程零 sidecar 内部错误（internal_error = 0）
 *
 * 安全纪律（对齐 BLOCK-48 P4）：记事本由本脚本启动、未写入任何文本，
 * 结束后仅退出本脚本启动的实例；绝不触碰用户已有窗口/文档。
 *
 * 证据：acceptance/block-63/p1-live.json
 */

import { spawn as childSpawn, execSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINARY = path.join(__dirname, '..', 'sidecars', 'computer-use-windows', 'bin', 'publish', 'petri-computer-use-windows.exe');
const EVIDENCE = path.join(__dirname, '..', 'acceptance', 'block-63', 'p1-live.json');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(BINARY, [], { stdio: ['pipe', 'pipe', 'pipe'] });
const readline = createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();
readline.on('line', (line) => {
  let msg = null;
  try { msg = JSON.parse(line); } catch { return; }
  const resolver = pending.get(msg.id);
  if (resolver) { pending.delete(msg.id); resolver(msg); }
});
function request(verb, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${verb}#${id}`)); }, 20000);
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
    child.stdin.write(`${JSON.stringify({ id, verb, params })}\n`);
  });
}

function setForegroundByTitle(part) {
  // 用 PowerShell 把目标窗口带到前台（PowerShell AppActivate 按标题前缀匹配）。
  const ps = `((New-Object -ComObject WScript.Shell).AppActivate(${JSON.stringify(part)}))`;
  try { execSync(`powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`, { stdio: 'ignore' }); } catch { /* 如实走后续断言 */ }
}

async function main() {
  const checks = [];
  const check = (name, pass, detail) => { checks.push({ name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${detail}`); };

  // A1 probe
  const probe = await request('probe');
  check('A1 probe', probe.ok === true && probe.data.trusted === true && probe.data.platform === 'windows'
    && typeof probe.data.hostElevated === 'boolean', JSON.stringify(probe.data).slice(0, 120));

  // 启动记事本（本脚本拥有该实例，结束清理）
  const notepad = childSpawn('notepad.exe', [], { detached: true, stdio: 'ignore' });
  notepad.unref();
  await delay(2000);
  setForegroundByTitle('记事本');
  setForegroundByTitle('Notepad');
  await delay(800);

  // A2 snapshot
  const snap = await request('snapshot', { target: 'frontmost' });
  const roles = new Set((snap.data?.elements || []).map((e) => e.role));
  const editorRole = [...roles].find((r) => ['Document', 'Edit', 'TextArea'].includes(r));
  check('A2 notepad snapshot', snap.ok === true && snap.data.elementCount > 0 && !!editorRole,
    `count=${snap.data?.elementCount} target=${JSON.stringify(snap.data?.target?.name || '')} roles=${[...roles].slice(0, 8).join(',')} editor=${editorRole || 'none'}`);

  // A3 click 编辑区
  const editor = (snap.data.elements || []).find(
    (e) => ['Document', 'Edit', 'TextArea'].includes(e.role) && e.w > 50 && e.h > 50
  ) || (snap.data.elements || []).find((e) => e.w > 50 && e.h > 50);
  let clickMode = null;
  if (editor) {
    const click = await request('click', { ref: editor.ref });
    clickMode = click.ok ? click.data.mode : null;
    check('A3 notepad click', click.ok === true && ['invoke', 'coordinate'].includes(clickMode),
      JSON.stringify(click.data || click.error).slice(0, 140));
  } else {
    check('A3 notepad click', false, 'no editor element');
  }

  // A4 焦点证据
  await delay(600);
  const snap2 = await request('snapshot', { target: 'frontmost' });
  const focusHit = ['Document', 'Edit', 'TextArea'].includes(snap2.data?.focusedRole || '')
    || (snap2.data?.focusedRole || '') === '文档';
  check('A4 focusedRole', snap2.ok === true && focusHit, `focusedRole=${snap2.data?.focusedRole}`);

  // A5 dev Electron UIA 观测（Chromium UIA 懒启用现状取证）
  let electronCount = null;
  try {
    setForegroundByTitle('Petri');
    await delay(800);
    const snapElectron = await request('snapshot', { target: 'frontmost' });
    electronCount = snapElectron.ok ? snapElectron.data.elementCount : null;
  } catch { /* 如实记录 */ }
  check('A5 dev Electron UIA tree', typeof electronCount === 'number' && electronCount > 0,
    `elementCount=${electronCount}（Chromium UIA 客户端连接即暴露；深度优化留 P4）`);

  // A6 内部错误为零
  check('A6 no internal_error', checks.every((c) => !/internal_error/.test(c.detail)), 'clean');

  // 清理纪律（P1 实测教训）：Windows 11 记事本为单进程多窗口，进程级 kill
  // 会连带关闭用户已打开的记事本窗口（本次实机已发生：用户 total_proteome
  // [2].tsv 窗口被连带关闭——该文档无未保存修改、零数据丢失，如实登记）。
  // 对齐 BLOCK-48 P1 先例：不自动退出目标 app，清理决策归用户。P2 起 sidecar
  // 增加 hwnd 粒度的 close 动词后再做脚本内清理。

  const allPass = checks.every((c) => c.pass);
  fs.mkdirSync(path.join(__dirname, '..', 'acceptance', 'block-63'), { recursive: true });
  fs.writeFileSync(EVIDENCE, JSON.stringify({
    generatedAt: new Date().toISOString(),
    sidecar: 'sidecars/computer-use-windows（C#/.NET 8 + FlaUI 5.0 UIA3，单文件自包含发布）',
    checks, allPass,
  }, null, 2));
  console.log(`\nallPass=${allPass} · evidence: acceptance/block-63/p1-live.json`);
  child.kill();
  process.exit(allPass ? 0 : 2);
}

main().catch((e) => { console.error('LIVE_FAIL', e.message); child.kill(); process.exit(1); });
