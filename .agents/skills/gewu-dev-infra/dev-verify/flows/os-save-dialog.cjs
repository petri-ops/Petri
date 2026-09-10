#!/usr/bin/env node
'use strict';

/**
 * BLOCK-75 — OS 级验收 flow：原生「另存为」对话框三断言链（无人化阶梯第 ③ 级做实）。
 *
 * 目标链路：设置页「导出诊断日志」→ diagnostic:export → 原生保存框 → 落盘。
 * 触发方式：CDP 调 window.biof3Desktop.diagnostic.export()（与按钮同 IPC 链路，不 await）。
 * 驱动方式：BLOCK-63 sidecar（computer-use-host 八动词）hwnd 直投——P0 实测弹窗受
 * Windows 前台锁影响不一定是前台窗口，必须 EnumWindows 枚举定位（lib-block75-os.cjs），
 * type 走 ValuePattern、click 走 UIA Invoke，均后台窗口可用。
 *
 * 断言链：
 *   A 保存落盘 —— 键入完整路径 → 保存 → zip 落盘 + IPC {ok:true,path 对账}
 *   B 取消不落盘 —— 键入新路径 → 取消 → IPC {ok:false,error:'cancelled'} + 磁盘无文件
 *   C 覆盖确认 —— 对已存在文件保存 → 「确认另存为」弹窗 → 是=替换为新内容 / 否=留在对话框，
 *     再取消后原文件原样（替换语义正反两面）
 *
 * 已知事实（P0）：对话框标题 Windows 固定「另存为」（Electron 自定义 title 不生效）；
 * 文件名 Edit 名为「文件名:」；保存按钮「保存(S)」；确认弹窗标题「确认另存为」。
 */
const path = require('node:path');
const fs = require('node:fs');

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

const REPO = findRepoRoot(__dirname) || process.cwd();
const lib = require(path.join(REPO, '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const osWin = require(path.join(REPO, 'scripts', 'lib-block75-os.cjs'));

const SAVE_TITLE_RE = /^(另存为|Save As|导出诊断日志)/;
const CONFIRM_TITLE_RE = /^(确认另存为|Confirm Save As)/;

module.exports = {
  id: 'os-save-dialog',
  description: 'BLOCK-75 OS 级验收：原生另存为对话框三断言链（保存落盘/取消不落盘/覆盖确认）',
  evidenceDir: path.join(REPO, 'acceptance', 'block-75'),

  async run(ctx) {
    const { assert } = ctx;
    const { getComputerUseHost } = require(path.join(REPO, 'core', 'biof3-server', 'helpers', 'computer-use-host.js'));
    const host = getComputerUseHost();
    const tmpDir = path.join(REPO, '.biof3-tmp-block75');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));

    /** 读 IPC promise 结果（对话框关闭后 ≤10s 解析）。 */
    async function readResult(client) {
      for (let i = 0; i < 20; i++) {
        await delay(500);
        const raw = await lib.evalJs(client, `JSON.stringify(window.__osSaveResult)`).catch(() => 'null');
        if (raw && raw !== 'null') return JSON.parse(raw);
      }
      return null;
    }

    /**
     * 驱动一次另存为对话框：键入 filePath 后按 action 点击。
     * 返回 { hwnd, typeMode } | null（对话框未出现）。
     */
    async function driveDialog(client, { action, filePath, screenshotFile }) {
      const hit = await osWin.waitForDialog({ timeoutMs: 20_000, titleRe: SAVE_TITLE_RE });
      if (!hit) return null;
      const snap = await host.requestWithRecovery('snapshot', { target: { hwnd: hit.hwnd }, maxElements: 200 }).catch(() => null);
      if (!snap || snap.ok === false) return null;
      const els = snap.elements || [];
      const edit = els.find((e) => e.role === 'Edit' && /文件名/.test(String(e.name || '')))
        || els.find((e) => e.role === 'ComboBox' && /文件名/.test(String(e.name || '')));
      if (!edit) return { hwnd: hit.hwnd, typeMode: null, error: 'filename_edit_not_found' };
      let typeMode = null;
      if (filePath) {
        const typed = await host.requestWithRecovery('type', { target: { hwnd: hit.hwnd }, ref: edit.ref, text: filePath });
        typeMode = typed && typed.ok !== false ? (typed.mode || 'ok') : `type_failed:${JSON.stringify(typed).slice(0, 80)}`;
      }
      if (screenshotFile) {
        await host.requestWithRecovery('screenshot', { target: { hwnd: hit.hwnd }, out: path.join(module.exports.evidenceDir, screenshotFile) }).catch(() => {});
      }
      const btn = els.find((e) => e.role === 'Button'
        && (action === 'save' ? /^保存/.test(String(e.name || '')) : /^取消/.test(String(e.name || ''))));
      if (!btn) return { hwnd: hit.hwnd, typeMode, error: `${action}_button_not_found` };
      const clicked = await host.requestWithRecovery('click', { target: { hwnd: hit.hwnd }, ref: btn.ref });
      if (!clicked || clicked.ok === false) return { hwnd: hit.hwnd, typeMode, error: 'click_failed' };
      return { hwnd: hit.hwnd, typeMode, clickMode: clicked.mode || '' };
    }

    /** 兜底：关闭任何遗留的另存为对话框（上一链/上次运行的残留在场会串链）。 */
    async function closeLeftoverDialogs() {
      for (let i = 0; i < 3; i++) {
        const hit = await osWin.findDialog({ titleRe: SAVE_TITLE_RE }).catch(() => null);
        if (!hit) return;
        await host.requestWithRecovery('close', { target: { hwnd: hit.hwnd } }).catch(() => {});
        await delay(1000);
      }
    }

    /** 等文件就绪（导出含日志 flush + zip 压缩，留 15s）。
     *  existsOnly=false 时等待「内容变化」——覆盖链里文件预先存在，
     *  存在性检查会瞬间读到替换前的旧字节（首跑 C4 实测踩坑）。 */
    async function waitForFile(p, { until = null } = {}) {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (fs.existsSync(p)) {
          const buf = fs.readFileSync(p);
          if (buf.length > 0 && (!until || until(buf))) return buf;
        }
        await delay(500);
      }
      return null;
    }

    try {
      // ── 0) dev Electron 就绪 + 真主窗（项目树+右栏探测）+ 预清场 ──
      const targets = await lib.pollTargets({ timeoutMs: 15_000 });
      const pages = lib.filterPageTargets(targets, /localhost:3000/);
      assert('A0 spa_page_target_present', pages.length > 0, pages.map((p) => p.url).join('|').slice(0, 120) || 'none');
      if (!pages.length) return false;
      const main = await lib.selectPageTarget(pages, {
        probe: (client) => lib.evalJs(client, `!!(document.querySelector('[class*="projectTree"]') && document.querySelector('[class*="rightCol"]'))`, 5_000).catch(() => false),
      });
      const client = await lib.connectTarget(main);
      try {
        await closeLeftoverDialogs();
        await lib.evalJs(client, `!!window.biof3Desktop?.diagnostic?.export`, 5_000).then((ok) => assert('A0 diagnostic_bridge_present', ok === true, String(ok)));

        // ── 链 A：保存落盘 ──
        const savePath = path.join(tmpDir, `block75-save-${stamp}.zip`);
        await lib.evalJs(client, `window.__osSaveResult = null; window.biof3Desktop.diagnostic.export().then((r) => { window.__osSaveResult = r; }).catch((e) => { window.__osSaveResult = { ok: false, error: String(e) }; }); 'fired'`, 5_000);
        const a = await driveDialog(client, { action: 'save', filePath: savePath, screenshotFile: 'os-save-dialog-typed.png' });
        assert('A1 native_save_dialog_appeared', !!a && !a.error, a ? `hwnd=${a.hwnd} type=${a.typeMode}${a.error ? ' err=' + a.error : ''}` : '20s 未枚举到另存为对话框');
        if (!a || a.error) throw new Error('chain A aborted: ' + JSON.stringify(a));
        assert('A2 filename_typed_via_value_pattern', typeof a.typeMode === 'string' && a.typeMode.startsWith('value_pattern'), String(a.typeMode));
        const aBuf = await waitForFile(savePath);
        assert('A3 save_writes_file_to_disk', !!aBuf && aBuf.length > 0, aBuf ? `${savePath} (${aBuf.length} bytes)` : '15s 内未落盘');
        const isZip = !!aBuf && aBuf[0] === 0x50 && aBuf[1] === 0x4b;
        const isTxtFallback = !!aBuf && aBuf.slice(0, 12).toString('utf8').startsWith('=== Gewu Di');
        assert('A4 saved_content_is_diagnostic_package', isZip || isTxtFallback, `head=${aBuf ? aBuf.slice(0, 4).toString('hex') : 'n/a'} zip=${isZip} txtFallback=${isTxtFallback}`);
        const aRes = await readResult(client);
        assert('A5 ipc_returns_ok_with_path', !!aRes && aRes.ok === true && path.normalize(aRes.path || '') === path.normalize(savePath), JSON.stringify(aRes).slice(0, 160));

        // ── 链 B：取消不落盘 ──
        const cancelPath = path.join(tmpDir, `block75-cancel-${stamp}.zip`);
        await lib.evalJs(client, `window.__osSaveResult = null; window.biof3Desktop.diagnostic.export().then((r) => { window.__osSaveResult = r; }).catch((e) => { window.__osSaveResult = { ok: false, error: String(e) }; }); 'fired'`, 5_000);
        const b = await driveDialog(client, { action: 'cancel', filePath: cancelPath });
        assert('B1 dialog_reappeared_for_cancel', !!b && !b.error, b ? `hwnd=${b.hwnd}${b.error ? ' err=' + b.error : ''}` : '20s 未枚举到另存为对话框');
        const bRes = await readResult(client);
        assert('B2 cancel_returns_cancelled', !!bRes && bRes.ok === false && bRes.error === 'cancelled', JSON.stringify(bRes).slice(0, 120));
        assert('B3 cancel_writes_nothing_to_disk', !fs.existsSync(cancelPath), cancelPath);

        // ── 链 C：覆盖确认（替换语义正反两面）──
        const overPath = path.join(tmpDir, `block75-overwrite-${stamp}.zip`);
        fs.writeFileSync(overPath, 'OLD-DATA-NOT-A-ZIP');
        await lib.evalJs(client, `window.__osSaveResult = null; window.biof3Desktop.diagnostic.export().then((r) => { window.__osSaveResult = r; }).catch((e) => { window.__osSaveResult = { ok: false, error: String(e) }; }); 'fired'`, 5_000);
        const c = await driveDialog(client, { action: 'save', filePath: overPath });
        assert('C1 dialog_reappeared_for_overwrite', !!c && !c.error, c ? `hwnd=${c.hwnd}${c.error ? ' err=' + c.error : ''}` : '20s 未枚举到另存为对话框');
        if (!c || c.error) throw new Error('chain C aborted: ' + JSON.stringify(c));

        const confirm = await osWin.waitForDialog({ timeoutMs: 10_000, titleRe: CONFIRM_TITLE_RE });
        assert('C2 overwrite_confirm_prompt_appeared', !!confirm, confirm ? `hwnd=${confirm.hwnd} title=${confirm.title}` : '10s 未出现确认另存为弹窗');
        if (confirm) {
          const csnap = await host.requestWithRecovery('snapshot', { target: { hwnd: confirm.hwnd }, maxElements: 60 }).catch(() => null);
          const yes = csnap && (csnap.elements || []).find((e) => e.role === 'Button' && /^是/.test(String(e.name || '')));
          assert('C3 confirm_yes_button_readable', !!yes, JSON.stringify(yes ? yes.name : 'no 是 button'));
          if (yes) {
            await host.requestWithRecovery('click', { target: { hwnd: confirm.hwnd }, ref: yes.ref });
            const cBuf = await waitForFile(overPath, { until: (buf) => !buf.slice(0, 16).toString('utf8').startsWith('OLD-DATA') });
            const replaced = !!cBuf && !(cBuf.slice(0, 16).toString('utf8').startsWith('OLD-DATA'));
            assert('C4 yes_replaces_file_content', replaced, cBuf ? `head=${cBuf.slice(0, 4).toString('hex')} bytes=${cBuf.length}` : 'file missing');
            const cRes = await readResult(client);
            assert('C5 yes_ipc_returns_ok', !!cRes && cRes.ok === true, JSON.stringify(cRes).slice(0, 120));

            // 「否」分支：确认弹窗点否 → 对话框留在屏上 → 再取消 → 文件原样
            const overMtime = fs.statSync(overPath).mtimeMs;
            await lib.evalJs(client, `window.__osSaveResult = null; window.biof3Desktop.diagnostic.export().then((r) => { window.__osSaveResult = r; }).catch((e) => { window.__osSaveResult = { ok: false, error: String(e) }; }); 'fired'`, 5_000);
            const c2 = await driveDialog(client, { action: 'save', filePath: overPath });
            const confirm2 = await osWin.waitForDialog({ timeoutMs: 10_000, titleRe: CONFIRM_TITLE_RE });
            assert('C6 overwrite_prompt_again_on_second_save', !!confirm2, confirm2 ? `hwnd=${confirm2.hwnd}` : '10s 未出现确认弹窗');
            if (confirm2) {
              const csnap2 = await host.requestWithRecovery('snapshot', { target: { hwnd: confirm2.hwnd }, maxElements: 60 }).catch(() => null);
              const no = csnap2 && (csnap2.elements || []).find((e) => e.role === 'Button' && /^否/.test(String(e.name || '')));
              if (no) {
                await host.requestWithRecovery('click', { target: { hwnd: confirm2.hwnd }, ref: no.ref });
                await delay(1200);
                // 点否后对话框留在屏上（回到另存为），补一次取消收场
                await driveDialog(client, { action: 'cancel', filePath: null });
                const c2Res = await readResult(client);
                assert('C7 no_branch_returns_cancelled', !!c2Res && c2Res.ok === false && c2Res.error === 'cancelled', JSON.stringify(c2Res).slice(0, 120));
                const kept = fs.readFileSync(overPath);
                const unchanged = kept.slice(0, 16).toString('utf8').startsWith('OLD-DATA') === false
                  && fs.statSync(overPath).mtimeMs === overMtime;
                assert('C8 no_branch_keeps_file_untouched', unchanged, `bytes=${kept.length} mtimeUnchanged=${fs.statSync(overPath).mtimeMs === overMtime}`);
              } else {
                assert('C7 no_branch_returns_cancelled', false, 'no 否 button in confirm prompt');
                await driveDialog(client, { action: 'cancel', filePath: null });
              }
            } else {
              await driveDialog(client, { action: 'cancel', filePath: null });
            }
          }
        }
      } finally {
        try { client.socket.close(); } catch { /* already closed */ }
        await closeLeftoverDialogs();
      }
    } finally {
      try { host.stop(); } catch { /* sidecar cleanup */ }
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    return true;
  },
};
