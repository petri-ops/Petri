@echo off
rem Petri-AutoSync scheduled task wrapper (every 2 min) -> scripts/auto-sync-remote.sh
cd /d "D:\1.WorkDir\petri-desktop"
"D:\Program Files\Git\usr\bin\bash.exe" -lc "bash scripts/auto-sync-remote.sh"
