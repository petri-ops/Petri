' [DISABLED 2026-09-21, user ruling: dev stack should be an intentional process - start when
' needed, gone when not; the 4s-timeout health check false-positived during backend
' boot-freeze windows and force-restarted the stack mid-test (killing test instances).
' Re-enable: MSYS_NO_PATHCONV=1 schtasks /Change /TN Petri-StackWatchdog /ENABLE
' Petri-StackWatchdog hidden wrapper (ASCII-only: WSH reads ANSI/GBK, UTF-8 bytes can
' swallow line breaks and turn the whole script into comments - 2026-09-19 lesson).
' Runs the watchdog powershell with window style 0 (hidden), wait=True so
' LastTaskResult stays truthful in schtasks.
' BLOCK-165: repo root resolved relative to this script; userData dir falls back
' from the pre-rename legacy name to the new name (see restart-dev-stack.sh D3/D7 note).
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
ud = root & "\.biof3-dev-user-data"
If Not fso.FolderExists(ud) Then ud = root & "\.petri-dev-user-data"
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & ud & "\stack-watchdog.ps1""", 0, True
