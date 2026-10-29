# block321c-resize-window.ps1 - resize one top-level window by hwnd (ASCII only)
param([int]$TargetHwnd, [int]$W, [int]$H)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win321c {
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$h = [IntPtr]$TargetHwnd
# Keep the TEST window hidden (BLOCK-100 discipline): resize only, no ShowWindow.
# A hidden BrowserWindow still dispatches DOM resize events on OS resize.
[Win321c.SetWindowPos]($h, [IntPtr]::Zero, 10, 10, $W, $H, 0x0040) | Out-Null
Write-Output "resized"
