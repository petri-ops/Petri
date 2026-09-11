# resize-electron-window.ps1 - resize the dev Electron main window (ASCII only).
# Win32 SetWindowPos: CDP page session cannot call Browser.setWindowBounds (-32601),
# and a hidden-start Electron window may come up at a shrunken size (949px observed
# on 2026-09-11), which trips the workspace responsive breakpoint (left rail hidden).
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class GewuWin {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$procs = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }
if (-not $procs) { Write-Output "no-electron-window"; exit 1 }
# 3072x1780 physical px on a 4K screen (DPR ~2.1) = ~1463 CSS px, safely above
# the workspace compact breakpoint (max-width: 960px in useWorkspaceLayout.ts).
foreach ($p in $procs) {
  [GewuWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
  [GewuWin]::SetWindowPos($p.MainWindowHandle, [IntPtr]::Zero, 0, 0, 3072, 1780, 0x0040) | Out-Null
  Write-Output ("resized hwnd=" + $p.MainWindowHandle)
}
exit 0
