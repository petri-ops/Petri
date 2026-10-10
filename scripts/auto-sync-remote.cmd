@echo off
rem Petri-AutoSync scheduled task wrapper (every 2 min) -> scripts/auto-sync-remote.sh
rem BLOCK-165: repo root resolved relative to this script (no machine-absolute path).
cd /d "%~dp0.."
"D:\Program Files\Git\usr\bin\bash.exe" -lc "bash scripts/auto-sync-remote.sh"
