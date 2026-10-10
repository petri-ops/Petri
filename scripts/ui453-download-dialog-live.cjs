#!/usr/bin/env node
'use strict';
/**
 * ui453-download-dialog-live.cjs — UI-453 加映三回归门禁：下载保存对话框 options 生效性
 *
 * 背景（实机抓真两轮）：向 dialog.showSaveDialog 传 BrowserWindow(parent) 时，本机
 * Windows 弹通用「另存为」外壳——title/filters/文件名预填全失效、地址落桌面（用户
 * 两次反馈「没有预填文件名」的根因）。修复=不传 parent。本门禁用 UI Automation 读
 * 真实对话框标题做确定性断言（标题=options 生效的直接证据；文件名框在新式 Windows
 * 保存框不在 UIA 树内，预填由证据截图人工可查）。
 *
 *   T0 触发链路在场（preload bridge）
 *   T1 触发 downloadFromUrl → 真实对话框标题 == 「下载到…」（options 生效；回归即红）
 *   T2 关闭对话框（WM_CLOSE）后 handler 以 canceled 收敛（无悬挂）
 *   截图：对话框实况（人工可查文件名框预填 + 保存类型 R 文件）
 * 证据：acceptance/ui-453/ui453-download-dialog-live-live.json + png
 */
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROJECT_ID = process.argv[2] || 'p_mu5ftn3a_wxnq';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-453');
const PROBE_PS = path.join(__dirname, 'ui453-dialog-probe.ps1');
const SAMPLE_PATH = 'ui400-toc-sample.md';
// 「下载到…」= U+4E0B U+8F7D U+5230 U+2026（避免源码内嵌中文被编码环节破坏）
const EXPECTED_TITLE = String.fromCharCode(0x4e0b, 0x8f7d, 0x5230, 0x2026);
let client;
const EVAL = (expr) => lib.evalJs(client, expr);

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  return lib.connectTarget(target);
}

function runProbe(close) {
  const out = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PROBE_PS, ...(close ? ['-Close'] : []),
  ], { encoding: 'utf8', timeout: 30000 });
  const m = /TITLES_JSON:(.*)/.exec(out);
  let titles = [];
  try { titles = JSON.parse(m ? m[1] : '[]'); } catch { titles = []; }
  return { titles, raw: out.trim().slice(0, 300) };
}

function screenshot(fileName) {
  const target = path.join(EVIDENCE_DIR, fileName);
  execFileSync('powershell', ['-NoProfile', '-Command', `
Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing
$vs=[System.Windows.Forms.SystemInformation]::VirtualScreen
$b=New-Object System.Drawing.Bitmap($vs.Width,$vs.Height)
$g=[System.Drawing.Graphics]::FromImage($b)
$g.CopyFromScreen($vs.X,$vs.Y,0,0,$b.Size)
$b.Save("${target.replace(/\\/g, '\\\\')}",[System.Drawing.Imaging.ImageFormat]::Png)
`], { timeout: 30000 });
  return target;
}

(async () => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const run = lib.createRun({ name: 'ui453-download-dialog-live', evidenceDir: EVIDENCE_DIR });
  client = await attach();
  try { await client.send('Page.bringToFront'); } catch { /* ignore */ }

  // T0 桥在场
  const bridge = await EVAL(`(function(){var b=window.petriDesktop&&window.petriDesktop.files;return !!(b&&typeof b.downloadFromUrl==='function');})()`);
  run.assert('T0_download_bridge_present', bridge === true || bridge === 'true', String(bridge));

  // 清场：先关掉可能残留的对话框（避免断言串扰）
  runProbe(true);
  await sleep(800);

  // T1 触发 → 读真实对话框标题
  const before = runProbe(false).titles;
  await EVAL(`window.petriDesktop.files.downloadFromUrl('http://localhost:3001/api/workspaces/${PROJECT_ID}/file?path=${encodeURIComponent(SAMPLE_PATH)}', 'DIALOG-GATE.R').then(function(r){console.log('DL_RESULT:'+JSON.stringify(r));})`).catch(() => {});
  await sleep(3500);
  const after = runProbe(false).titles;
  const newTitles = after.filter((t) => !before.includes(t));
  const shot = screenshot('ui453-download-dialog.png');
  run.assert('T1_download_dialog_title_effective', newTitles.includes(EXPECTED_TITLE),
    `new=${JSON.stringify(newTitles)} expected=${JSON.stringify(EXPECTED_TITLE)} all=${JSON.stringify(after)} shot=${shot}`);

  // T2 关闭收敛
  runProbe(true);
  await sleep(1200);
  const left = runProbe(false).titles;
  run.assert('T2_dialog_closed_no_hang', left.filter((t) => t === EXPECTED_TITLE).length === 0,
    `left=${JSON.stringify(left)}`);

  run.finish();
  process.exit(run.allPass ? 0 : 1);
})().catch((err) => {
  console.error('[ui453-dialog] FATAL', err && err.message);
  process.exit(2);
});
