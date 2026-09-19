' Gewu-StackWatchdog hidden wrapper (ASCII-only: WSH reads ANSI/GBK, UTF-8 bytes can
' swallow line breaks and turn the whole script into comments - 2026-09-19 lesson).
' Runs the watchdog powershell with window style 0 (hidden), wait=True so
' LastTaskResult stays truthful in schtasks.
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ""D:\1.WorkDir\biof3-desktop\.biof3-dev-user-data\stack-watchdog.ps1""", 0, True
