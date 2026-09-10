# BLOCK-75 window enumeration for dev-verify flows.
# Output lines: hwnd|class|base64(title)  -- title is base64 because the console
# codepage of redirected powershell.exe output is uncontrollable (GBK/OEM).
# NOTE: keep this file ASCII-only: PowerShell 5.1 parses BOM-less .ps1 as ANSI,
# and UTF-8 Chinese comments break the here-string parser (P0 lesson).
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WinEnum3 {
  public delegate bool EnumProc(IntPtr h, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@

$script:lines = New-Object System.Collections.ArrayList
$pidSet = @(Get-Process electron -ErrorAction SilentlyContinue | ForEach-Object { [uint32]$_.Id })

$cb = [WinEnum3+EnumProc]{
  param($h, $lp)
  $w = 0
  [WinEnum3]::GetWindowThreadProcessId($h, [ref]$w) | Out-Null
  if ($pidSet -contains $w) {
    $t = New-Object System.Text.StringBuilder 256
    [WinEnum3]::GetWindowText($h, $t, 256) | Out-Null
    $c = New-Object System.Text.StringBuilder 256
    [WinEnum3]::GetClassName($h, $c, 256) | Out-Null
    if ([WinEnum3]::IsWindowVisible($h)) {
      $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($t.ToString()))
      $script:lines.Add("$($h.ToInt64())|$($c.ToString())|$b64") | Out-Null
    }
  }
  return $true
}
[WinEnum3]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null
$script:lines | ForEach-Object { Write-Output $_ }
Write-Output "FG=$([WinEnum3]::GetForegroundWindow().ToInt64())"
