' auto-sync-hidden.vbs - windowless wrapper for the Gewu-AutoSync scheduled task.
' The task action must go through wscript + this file: pointing the task action at the
' .cmd directly pops a console window every 2 minutes (user verdict 2026-09-19: hide
' it, do not stop it). Run window style 0 (SW_HIDE) hides the whole cmd->bash chain;
' sync logic in auto-sync-remote.sh is untouched.
' bWaitOnReturn=True so the task's LastTaskResult reflects the real sync outcome.
' NOTE: keep this file pure ASCII. WSH reads .vbs as ANSI (GBK codepage on this
' machine); UTF-8 Chinese comments get mojibake-eaten (a trailing UTF-8 byte swallows
' the newline) and silently turn the whole script into comments - exit 0, no-op.
CreateObject("Wscript.Shell").Run """D:\1.WorkDir\biof3-desktop\scripts\auto-sync-remote.cmd""", 0, True
