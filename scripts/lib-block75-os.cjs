#!/usr/bin/env node
// platform-note: windows-library — 本库 powershell 枚举窗口仅 Windows 提供，由消费方按平台护栏调用。（BLOCK-104 P4 门禁标注）
'use strict';

/**
 * BLOCK-75 — OS 级窗口定位共享库（dev-verify flow / P0 探测共用）。
 *
 * 背景（P0 实测）：原生保存对话框受 Windows 前台锁影响可能不成为前台窗口，
 * sidecar 的 frontmost 快照不可靠；改为 EnumWindows 枚举 electron 进程顶层窗口
 * （class/title 精确匹配 → hwnd 直投），sidecar 对后台窗口的
 * snapshot/type(ValuePattern)/click(Invoke) 均可用，彻底摆脱前台依赖。
 */
const { execFile } = require('node:child_process');
const path = require('node:path');

const PS1 = path.join(__dirname, 'block75-enum-windows.ps1');

/** 枚举 electron 进程全部可见顶层窗口 → [{ hwnd, klass, title }]。 */
function listElectronWindows() {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1],
      { encoding: 'utf8', timeout: 15_000, windowsHide: true, maxBuffer: 1 << 20 },
      (err, stdout) => {
        if (err) return reject(err);
        const wins = [];
        for (const line of String(stdout).split(/\r?\n/)) {
          // ps1 输出 hwnd|class|base64(title)——标题走 base64 规避控制台编码不可控
          const m = line.match(/^(\d+)\|([^|]*)\|(.*)$/);
          if (!m) continue;
          let title = '';
          try { title = Buffer.from(m[3], 'base64').toString('utf8'); } catch { title = m[3]; }
          wins.push({ hwnd: Number(m[1]), klass: m[2], title });
        }
        resolve(wins);
      },
    );
  });
}

/**
 * 按窗口类/标题找对话框 hwnd。
 * @param {object} opts
 * @param {RegExp} [opts.titleRe]  标题匹配（默认 /另存为|Save As|导出诊断日志/）
 * @param {string} [opts.klass]    窗口类（默认 '#32770' 标准 Win32 对话框）
 * @returns {Promise<{hwnd:number,title:string}|null>}
 */
async function findDialog({ titleRe = /^(另存为|Save As|导出诊断日志)/, klass = '#32770' } = {}) {
  const wins = await listElectronWindows();
  const hit = wins.find((w) => w.klass === klass && titleRe.test(w.title));
  return hit ? { hwnd: hit.hwnd, title: hit.title } : null;
}

/** 轮询直到对话框出现或超时。 */
async function waitForDialog({ timeoutMs = 20_000, intervalMs = 700, titleRe, klass } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = await findDialog({ titleRe, klass }).catch(() => null);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

module.exports = { listElectronWindows, findDialog, waitForDialog };
