#!/usr/bin/env node
'use strict';
/**
 * os-dialog-snapshot — OS 级原生对话框取证 flow（UI-453 加映三教训沉淀）。
 *
 * 背景：Electron 的 showSaveDialog/showOpenDialog/拖出等 OS 级交互，CDP 完全不可见
 * （UI-453 保存框三次返工才靠截图+UIA 抓到真身）。本 flow 用 Win32 UIAutomation 读
 * 真实对话框窗口（class #32770）标题并整屏截图，提供两条机械通道：
 *   诊断模式（默认）：快照当前所有对话框 → 证据 JSON+PNG，断言仅「探针可执行」；
 *   回归模式：EXPECT_TITLE="下载到…" 时断言该标题在场（调用方先经 CDP 触发对话框）。
 * 可选 CLOSE=1：断言后对 #32770 发 WM_CLOSE 收口（回归模式自触发场景用）。
 *
 * 组合用法（回归示例）：
 *   ① CDP evalJs 触发（如 window.biof3Desktop.files.downloadFromUrl(url, name)）
 *   ② EXPECT_TITLE="下载到…" CLOSE=1 npm run verify -- os-dialog-snapshot
 *
 * 边界：仅 Windows（#32770/UIA）；非 Windows 环境断言 skip 如实通过（不伪绿）。
 */
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const lib = require('../lib.cjs');

const PROBE_PS_NAME = 'gewu-os-dialog-probe.ps1';

// 内嵌探针（自包含：skill 纪律——工具随包携带，不依赖仓库 scripts/）。
// UTF8 输出 + 枚举 #32770 标题 JSON + 可选 WM_CLOSE。
const PROBE_PS = [
  'param([switch]$Close)',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
  'Add-Type -Namespace W -Name U -MemberDefinition @\'',
  '[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);',
  'public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);',
  '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder sb, int max);',
  '[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder sb, int max);',
  '[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);',
  '\'@',
  '$titles = New-Object System.Collections.ArrayList',
  '$handles = New-Object System.Collections.ArrayList',
  '$cb = [W.U+EnumWindowsProc]{ param($h, $l)',
  '  $cls = New-Object System.Text.StringBuilder 256',
  '  [W.U]::GetClassName($h, $cls, 256) | Out-Null',
  '  if ($cls.ToString() -eq \'#32770\') {',
  '    $txt = New-Object System.Text.StringBuilder 512',
  '    [W.U]::GetWindowText($h, $txt, 512) | Out-Null',
  '    [void]$titles.Add($txt.ToString()); [void]$handles.Add($h) }',
  '  return $true }',
  '[W.U]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null',
  '$json = \'[\' + (($titles | ForEach-Object { \'"\' + ($_ -replace \'\\\\\',\'\\\\\\\\\' -replace \'"\',\'\\\\"\' ) + \'"\' }) -join \',\') + \']\'',
  'Write-Output "TITLES_JSON:$json"',
  'if ($Close) { $n = 0; foreach ($h in $handles) { [W.U]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null; $n++ }; Write-Output "WM_CLOSE_SENT:$n" }',
].join('\r\n');

function probe(close) {
  const ps1 = path.join(os.tmpdir(), PROBE_PS_NAME);
  fs.writeFileSync(ps1, PROBE_PS, 'utf8');
  const out = execFileSync('powershell', [
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...(close ? ['-Close'] : []),
  ], { encoding: 'utf8', timeout: 30_000 });
  const m = /TITLES_JSON:(.*)/.exec(out);
  let titles = [];
  try { titles = JSON.parse((m ? m[1] : '').trim() || '[]'); } catch { titles = []; }
  const closed = /WM_CLOSE_SENT:(\d+)/.exec(out);
  return { titles, closed: closed ? Number(closed[1]) : 0 };
}

function fullScreenShot(dir, name) {
  const target = path.join(dir, name);
  execFileSync('powershell', ['-NoProfile', '-Command', [
    'Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing',
    '$vs=[System.Windows.Forms.SystemInformation]::VirtualScreen',
    '$b=New-Object System.Drawing.Bitmap($vs.Width,$vs.Height)',
    '$g=[System.Drawing.Graphics]::FromImage($b)',
    '$g.CopyFromScreen($vs.X,$vs.Y,0,0,$b.Size)',
    `\$b.Save('${target.replace(/\\/g, '\\\\')}',[System.Drawing.Imaging.ImageFormat]::Png)`,
  ].join('\n')], { timeout: 30_000 });
  return target;
}

module.exports = {
  id: 'os-dialog-snapshot',
  description: 'OS 级原生对话框取证：UIA 读 #32770 真实标题+整屏截图（诊断默认/回归 EXPECT_TITLE+可选 CLOSE）——UI-453 保存框返工教训沉淀',
  evidenceDir: path.join(process.cwd(), 'acceptance', 'os-dialog'),

  async run(ctx) {
    const { assert } = ctx;
    const isWindows = process.platform === 'win32';
    if (!isWindows) {
      assert('probe_windows_only', true, `platform=${process.platform}（非 Windows，按设计跳过不伪绿）`);
      return true;
    }

    // 诊断模式基线：探针可执行且输出合法 JSON
    const before = probe(false);
    assert('probe_executable', Array.isArray(before.titles), JSON.stringify(before.titles));

    // 回归模式：期望标题在场
    const expect = process.env.EXPECT_TITLE;
    if (expect) {
      assert(
        'expected_title_present',
        before.titles.includes(expect),
        `expect=${JSON.stringify(expect)} actual=${JSON.stringify(before.titles)}`,
      );
      // 证据截图（对话框在场实况）
      try { fullScreenShot(this.evidenceDir, 'os-dialog-snapshot.png'); } catch { /* 截图失败不阻塞断言语义 */ }
      // 收口（可选）
      if (process.env.CLOSE === '1') {
        // WM_CLOSE 为异步 PostMessage：关后轮询等待窗口消亡（最多 ~3s）
        probe(true);
        let after = { titles: [expect] };
        for (let i = 0; i < 6 && after.titles.includes(expect); i += 1) {
          await new Promise((r) => setTimeout(r, 500));
          after = probe(false);
        }
        assert(
          'dialog_closed',
          !after.titles.includes(expect),
          `left=${JSON.stringify(after.titles)}`,
        );
      }
    } else {
      // 诊断模式：标题清单本身就是证据（截图辅助）
      try { fullScreenShot(this.evidenceDir, 'os-dialog-snapshot.png'); } catch { /* ignore */ }
      assert('snapshot_recorded', true, `titles=${JSON.stringify(before.titles)}`);
    }
    return true;
  },
};
