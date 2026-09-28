# UI-453 dialog gate helper: list #32770 dialog titles (JSON) + send WM_CLOSE to close them.
# Titles are compared as strings; the expected title is built from char codes (encoding-safe).
param([switch]$Close)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -Namespace W -Name U -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder sb, int max);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder sb, int max);
[DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
'@

$titles = New-Object System.Collections.ArrayList
$handles = New-Object System.Collections.ArrayList
$cb = [W.U+EnumWindowsProc]{ param($h, $l)
  $cls = New-Object System.Text.StringBuilder 256
  [W.U]::GetClassName($h, $cls, 256) | Out-Null
  if ($cls.ToString() -eq '#32770') {
    $txt = New-Object System.Text.StringBuilder 512
    [W.U]::GetWindowText($h, $txt, 512) | Out-Null
    [void]$titles.Add($txt.ToString())
    [void]$handles.Add($h)
  }
  return $true
}
[W.U]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null

# emit titles as JSON (manual quoting; titles here never contain quotes/backslashes in practice)
$json = '[' + (($titles | ForEach-Object { '"' + ($_ -replace '\\','\\' -replace '"','\"') + '"' }) -join ',') + ']'
Write-Output "TITLES_JSON:$json"

if ($Close) {
  $n = 0
  foreach ($h in $handles) {
    [W.U]::PostMessage($h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    $n++
  }
  Write-Output "WM_CLOSE_SENT:$n"
}
