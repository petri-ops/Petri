# block321c-enum-windows-rect.ps1 - enumerate electron top-level windows with rect (ASCII only)
# output: hwnd|base64(title)|left,top,width,height
# Includes hidden windows: the TEST instance never shows (BLOCK-100), yet its
# renderer still gets DOM resize events when the OS window is resized.
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum321c {
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
'@

$script:lines = New-Object System.Collections.ArrayList
$pidSet = @(Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })

$cb = [WinEnum321c+EnumProc]{
  param($h, $lp)
  $w = 0
  [WinEnum321c]::GetWindowThreadProcessId($h, [ref]$w) | Out-Null
  if ($pidSet -contains $w) {
    $t = New-Object System.Text.StringBuilder 256
    [WinEnum321c]::GetWindowText($h, $t, 256) | Out-Null
    $title = $t.ToString()
    if ($title) {
      $r = New-Object WinEnum321c+RECT
      [WinEnum321c]::GetWindowRect($h, [ref]$r) | Out-Null
      $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($title))
      $script:lines.Add("$($h.ToInt64())|$b64|$($r.Left),$($r.Top),$($r.Right - $r.Left),$($r.Bottom - $r.Top)") | Out-Null
    }
  }
  return $true
}
[WinEnum321c]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$script:lines | ForEach-Object { Write-Output $_ }
