#!/usr/bin/env node
'use strict';

/**
 * BLOCK-75 P0 实测探测（plan §4：原生文件对话框是标准 Win32 控件树，预期覆盖良好，P0 实测确认）：
 *   1) CDP 触发 window.petriDesktop.diagnostic.export()（与设置页按钮同 IPC 链路，不 await）
 *   2) sidecar snapshot(frontmost) 轮询原生保存框（title「导出诊断日志」）
 *   3) 断言控件面可读：文件名 Edit + 保存/取消 Button
 *   4) screenshot 对话框 → acceptance/block-75/p0-dialog.png
 *   5) sidecar click 取消 → window.__p0Result 应为 {ok:false,error:'cancelled'}
 * 证据：acceptance/block-75/block75-p0-probe-live.json（lib.createRun 契约）
 * 前置：dev Electron（9222）在跑；sidecar exe 已构建（bin/publish/）。
 */
const path = require('node:path');
const fs = require('node:fs');

const REPO = path.join(__dirname, '..');
const lib = require(path.join(REPO, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const osWin = require(path.join(__dirname, 'lib-block75-os.cjs'));
const { getComputerUseHost } = require(path.join(REPO, 'core', 'petri-server', 'helpers', 'computer-use-host.js'));

const EVIDENCE = path.join(REPO, 'acceptance', 'block-75');

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const run = lib.createRun({ name: 'block75-p0-probe', evidenceDir: EVIDENCE });
  const { assert } = run;
  const host = getComputerUseHost();

  // 1) dev Electron 就绪 + 真主窗（项目树+右栏探测，BLOCK-68 教训）
  const targets = await lib.pollTargets({ timeoutMs: 15_000 });
  const pages = lib.filterPageTargets(targets, /localhost:3000/);
  assert('p0-1 spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join('|').slice(0, 150) || 'none');
  const main = await lib.selectPageTarget(pages, {
    probe: (client) => lib.evalJs(client, `!!(document.querySelector('[class*="projectTree"]') && document.querySelector('[class*="rightCol"]'))`, 5_000).catch(() => false),
  });
  const client = await lib.connectTarget(main);
  try {
    // 2) 触发 diagnostic:export（不 await：对话框阻塞期间 evalJs 先返回）。
    //    前台锁对策：先 bringToFront 激活 Electron——后台进程弹的原生对话框不抢前台，
    //    P0 第一跑 frontmost 恒为主窗即此因。
    await client.send('Page.bringToFront');
    await delay(800);
    const bridge = await lib.evalJs(client, `JSON.stringify({ has: !!window.petriDesktop?.diagnostic?.export })`);
    assert('p0-2 diagnostic_bridge_present', bridge === 'true' || /"has":true/.test(bridge), bridge);
    await lib.evalJs(client, `window.__p0Result = null; window.petriDesktop.diagnostic.export().then((r) => { window.__p0Result = r; }).catch((e) => { window.__p0Result = { ok: false, error: String(e) }; }); 'fired'`, 5_000);

    // 3) 枚举定位对话框（前台锁免疫）：class #32770 + 标题 另存为|Save As|导出诊断日志
    //    P0 实测：弹窗受 Windows 前台锁影响可能不成为前台窗口，frontmost 快照不可靠；
    //    hwnd 直投后 sidecar 对后台窗口 snapshot/type/click 均可用。
    const host2 = getComputerUseHost();
    const hit = await osWin.waitForDialog({ timeoutMs: 20_000 });
    let snap = null;
    let dialogHwnd = 0;
    if (hit) {
      dialogHwnd = hit.hwnd;
      snap = await host2.requestWithRecovery('snapshot', { target: { hwnd: dialogHwnd }, maxElements: 160 }).catch(() => null);
    }
    assert('p0-3 native_save_dialog_found', !!snap && snap.ok !== false,
      snap ? `hwnd=${dialogHwnd} title=${JSON.stringify(hit.title)} elements=${snap.elementCount}` : '20s 内未枚举到另存为对话框');
    if (!snap || snap.ok === false) {
      // 收尾诊断 + 兜底关窗（不留对话框在用户屏幕上）
      const diag = await lib.evalJs(client, `JSON.stringify(window.__p0Result)`).catch(() => 'eval_err');
      if (dialogHwnd) await host.requestWithRecovery('close', { target: { hwnd: dialogHwnd } }).catch(() => {});
      await lib.screenshotPng(client, EVIDENCE, 'p0-abort-page.png');
      await run.finish({ note: 'dialog_not_found', bridgeResult: diag });
      console.error('DIAG __p0Result =', diag);
      process.exit(1);
    }

    // 4) 控件面可读：文件名 Edit/ComboBox + 保存/取消 Button
    const els = snap.elements || [];
    const edit = els.find((e) => (e.role === 'Edit' || e.role === 'ComboBox'));
    const saveBtn = els.find((e) => e.role === 'Button' && /保存|save/i.test(String(e.name || '')));
    const cancelBtn = els.find((e) => e.role === 'Button' && /取消|cancel/i.test(String(e.name || '')));
    assert('p0-4 filename_edit_readable', !!edit, JSON.stringify({ role: edit?.role, name: edit?.name, value: String(edit?.value || '').slice(0, 60) }));
    assert('p0-5 save_button_readable', !!saveBtn, JSON.stringify({ name: saveBtn?.name }));
    assert('p0-6 cancel_button_readable', !!cancelBtn, JSON.stringify({ name: cancelBtn?.name }));

    // 5) 对话框截图（sidecar 直出，host 层 out 无白名单）
    const shotPath = path.join(EVIDENCE, 'p0-dialog.png');
    const shot = await host.requestWithRecovery('screenshot', { target: dialogHwnd ? { hwnd: dialogHwnd } : { frontmost: true }, out: shotPath });
    assert('p0-7 dialog_screenshot_captured', shot && shot.ok !== false && fs.existsSync(shotPath), `out=${shotPath}`);

    // 6) 点取消 → 桥 promise 应解析 {ok:false,error:'cancelled'}
    const click = await host.requestWithRecovery('click', { target: { hwnd: dialogHwnd }, ref: cancelBtn.ref });
    assert('p0-8 cancel_clicked', click && click.ok !== false, JSON.stringify(click).slice(0, 120));
    let result = null;
    for (let i = 0; i < 10; i++) {
      await delay(500);
      result = JSON.parse(await lib.evalJs(client, `JSON.stringify(window.__p0Result)`));
      if (result) break;
    }
    assert('p0-9 export_cancelled_honest', !!result && result.ok === false && result.error === 'cancelled', JSON.stringify(result));
  } finally {
    try { client.socket.close(); } catch { /* already closed */ }
    try { host.stop(); } catch { /* sidecar cleanup */ }
  }

  const payload = await run.finish({});
  process.exit(payload.allPass ? 0 : 1);
}

const watchdog = setTimeout(() => { console.error('FAIL P0 探测 90s 看门狗超时'); process.exit(1); }, 90_000);
watchdog.unref();

main().catch((e) => { console.error('FAIL P0 探测异常:', e && e.message); process.exit(1); });
