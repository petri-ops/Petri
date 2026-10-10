#!/usr/bin/env node
'use strict';

/**
 * BLOCK-48 P1 实机验收（plan §6 P1 门）：本机真实完成 snapshot→click 闭环 +
 * 权限引导路径记录 + Electron AX 懒初始化坑复现与规避。
 *
 *   场景 A：权限链路——probe trusted:true（用户已手动授权 ZCode）；
 *           未授权 fail-closed 形状由契约测试覆盖（trust-aware 双态）。
 *   场景 B：Electron AX 懒初始化坑——dev Electron 无 AXManualAccessibility
 *           时语义树稀疏；axmanual 规避后树变丰富（复现 + 规避同轮取证）。
 *   场景 C：TextEdit snapshot→click——读窗口语义树 → 点「新建文档」→
 *           状态可观察变化（AXTextArea 出现）。TextEdit 未运行时才走启动流
 *           （运行中则退化为无害的文本区聚焦点击，绝不碰用户未保存内容）。
 *
 * 证据：acceptance/block-48/p1-live.json + p48-01-electron-ax.json
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline');

const ROOT = path.join(__dirname, '..');
const BINARY = path.join(ROOT, 'sidecars', 'computer-use', 'bin', 'petri-computer-use');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-48');

let child = null;
let nextId = 1;
const pending = new Map();

function startSidecar() {
  child = spawn(BINARY, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const msg = JSON.parse(line);
      const resolver = pending.get(msg.id);
      if (resolver) {
        pending.delete(msg.id);
        resolver(msg);
      }
    } catch { /* ignore non-JSON */ }
  });
  child.stderr.on('data', (d) => console.error(`[sidecar:stderr] ${d}`));
}

function request(verb, params = {}, timeoutMs = 20000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout: ${verb}#${id}`));
    }, timeoutMs);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    child.stdin.write(`${JSON.stringify({ id, verb, params })}\n`);
  });
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function log(msg) {
  try { fs.writeSync(1, `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`); } catch {}
}

const results = { startedAt: new Date().toISOString(), assertions: [] };
function assert(name, pass, detail = '') {
  results.assertions.push({ name, pass: !!pass, detail: String(detail).slice(0, 600) });
  log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + String(detail).slice(0, 160) : ''}`);
}

function runningApps(bundleMatch) {
  try {
    return execFileSync('pgrep', ['-f', bundleMatch], { encoding: 'utf8' }).trim().length > 0;
  } catch {
    return false;
  }
}

async function snapshotWithRetry(params, { tries = 6, delayMs = 1500, minCount = 1 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    await delay(delayMs);
    last = await request('snapshot', params);
    if (last?.ok && last?.data?.count >= minCount) return last;
  }
  return last;
}

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  startSidecar();
  await delay(300);

  // ── 场景 A：权限链路（已授权态）──────────────────────────────
  const probe = await request('probe');
  assert('A1 权限链路：probe trusted:true（用户已手动授权 ZCode）',
    probe?.ok && probe?.data?.trusted === true, JSON.stringify(probe?.data || probe));
  if (probe?.data?.trusted !== true) {
    results.finishedAt = new Date().toISOString();
    results.allPass = false;
    results.note = '宿主未授权辅助功能——请按 guidance 手动授权后重跑';
    fs.writeFileSync(path.join(EVIDENCE_DIR, 'p1-live.json'), JSON.stringify(results, null, 2) + '\n');
    process.exit(1);
  }

  // ── 场景 B：Electron AX 懒初始化坑（复现 + 规避）─────────────
  const electronAx = {};
  const before = await request('snapshot', {
    target: { bundleId: 'com.github.Electron' }, maxElements: 400,
  });
  assert('B1 dev Electron 可定位（bundleId + regular policy）', before?.ok === true, JSON.stringify(before?.error || { count: before?.data?.count }));
  const count1 = before?.ok ? before.data.count : 0;
  await request('axmanual', { target: { bundleId: 'com.github.Electron' } });
  const after = await snapshotWithRetry(
    { target: { bundleId: 'com.github.Electron' }, axManual: true, maxElements: 400 },
    { tries: 6, delayMs: 1500, minCount: count1 + 1 },
  );
  const count2 = after?.ok ? after.data.count : 0;
  electronAx.beforeCount = count1;
  electronAx.afterCount = count2;
  electronAx.verdict = count2 > count1 ? 'mitigated' : (count1 > 20 ? 'already_initialized' : 'no_change');
  assert('B2 AX 懒初始化：axmanual 规避后语义树丰富（或本机已初始化如实记录）',
    electronAx.verdict === 'mitigated' || electronAx.verdict === 'already_initialized',
    JSON.stringify(electronAx));
  const roles = new Set((after?.data?.elements || []).map((e) => e.role));
  assert('B3 语义树含可交互元素（button/textfield 类角色出现）',
    [...roles].some((r) => /button|textfield|checkbox|statictext/i.test(r || '')),
    `roles=${[...roles].slice(0, 10).join(',')}`);
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p48-01-electron-ax.json'),
    JSON.stringify({ ...electronAx, rolesSample: [...roles].slice(0, 20) }, null, 2) + '\n');

  // ── 场景 C：TextEdit snapshot→click 闭环 ─────────────────────
  const textEditRunning = runningApps('TextEdit$|TextEdit -') || runningApps('/TextEdit.app');
  let clickedOk = false;
  let clickDetail = {};
  let stateChanged = false;

  if (!textEditRunning) {
    // 干净启动流：doc chooser 点「新建文档」（首启可能较慢，轮询窗口放宽到 ~18s）
    execFileSync('open', ['-a', 'TextEdit']);
    await delay(3000);
    const snap1 = await snapshotWithRetry(
      { target: { bundleId: 'com.apple.TextEdit' }, maxElements: 300 },
      { tries: 12, delayMs: 1500, minCount: 3 },
    );
    assert('C1 TextEdit 启动且语义树可读', snap1?.ok === true && (snap1?.data?.count || 0) > 2,
      JSON.stringify({ count: snap1?.data?.count, error: snap1?.error }));
    const btn = (snap1?.data?.elements || []).find((e) =>
      /button/i.test(e.role || '')
      && /新建|new/i.test(`${e.description || ''} ${e.title || ''}`));
    assert('C2 找到「新建文档」按钮（语义定位）', !!btn, JSON.stringify(btn || {}));
    if (btn) {
      const click = await request('click', { ref: btn.ref });
      clickedOk = click?.ok === true;
      clickDetail = { method: click?.data?.method, ref: btn.ref, desc: btn.description || btn.title };
      assert('C3 AXPress 点击成功', clickedOk, JSON.stringify(click));
      await delay(2000);
      const snap2 = await request('snapshot', { target: { bundleId: 'com.apple.TextEdit' }, maxElements: 400 });
      const hasTextArea = (snap2?.data?.elements || []).some((e) => /textarea/i.test(e.role || ''));
      stateChanged = hasTextArea;
      assert('C4 状态可观察变化：编辑区出现（AXTextArea）', stateChanged,
        JSON.stringify({ count2: snap2?.data?.count }));
    }
    // 安全纪律：不自动退出 TextEdit——可能存在用户未保存内容（P1 实测教训：
    // 本机出现用户手动打开的「未命名2」文档），清理决策留给用户。
  } else {
    // TextEdit 运行中：绝不碰未保存内容——退化为只读快照 + 无害聚焦点击
    const snap = await snapshotWithRetry(
      { target: { bundleId: 'com.apple.TextEdit' }, maxElements: 300 },
      { tries: 3, delayMs: 1000, minCount: 1 },
    );
    assert('C1 TextEdit 运行中语义树可读', snap?.ok === true && (snap?.data?.count || 0) > 0,
      JSON.stringify({ count: snap?.data?.count }));
    const textArea = (snap?.data?.elements || []).find((e) => /textarea/i.test(e.role || ''));
    if (textArea) {
      const focusedBefore = snap?.data?.focusedRole || null;
      const click = await request('click', { ref: textArea.ref, prefer: 'coordinate' });
      clickedOk = click?.ok === true;
      clickDetail = { method: click?.data?.method, ref: textArea.ref, focusedBefore };
      assert('C2 运行中模式：文本区坐标点击（聚焦光标，无害）', clickedOk, JSON.stringify(click));
      await delay(800);
      const snapAfter = await request('snapshot', { target: { bundleId: 'com.apple.TextEdit' }, maxElements: 100 });
      const focusedAfter = snapAfter?.data?.focusedRole || null;
      stateChanged = focusedAfter === 'AXTextArea' || focusedBefore === 'AXTextArea';
      assert('C3 点击后焦点在文本区（focusedRole=AXTextArea）',
        focusedAfter === 'AXTextArea', JSON.stringify({ focusedBefore, focusedAfter }));
    } else {
      assert('C2 运行中无文本区可点（诚实记录，不制造状态）', false, JSON.stringify({ count: snap?.data?.count }));
    }
  }
  assert('C5 snapshot→click 闭环成立', clickedOk && stateChanged, JSON.stringify(clickDetail));

  const allPass = results.assertions.every((a) => a.pass);
  results.finishedAt = new Date().toISOString();
  results.allPass = allPass;
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p1-live.json'), JSON.stringify(results, null, 2) + '\n');
  log(`证据已写入 acceptance/block-48/p1-live.json (allPass=${allPass})`);
  child.kill();
  process.exit(allPass ? 0 : 1);
}

const watchdog = setTimeout(() => {
  console.error('FAIL P1 实机脚本 5min 看门狗超时');
  child?.kill();
  process.exit(1);
}, 5 * 60 * 1000);
watchdog.unref();

main().catch((e) => {
  console.error('FAIL 脚本异常:', e && e.message);
  child?.kill();
  process.exit(1);
});
