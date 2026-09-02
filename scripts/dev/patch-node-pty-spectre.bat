@echo off
REM =============================================================================
REM scripts/dev/patch-node-pty-spectre.bat
REM
REM BioF3 Desktop local development shim.
REM
REM Why this exists:
REM   biof3-desktop depends on node-pty 1.1.0-beta34, which sets
REM   `SpectreMitigation: 'Spectre'` in its MSVC configuration. Building that
REM   variant requires the optional "MSVC v142/v143 - Spectre-mitigated libs"
REM   component, which is NOT pulled in by `--includeRecommended`. Without
REM   those libs, MSBuild aborts with `error MSB8040` for every native target
REM   in node-pty (conpty, conpty_console_list, winpty-agent, winpty).
REM
REM What this script does:
REM   1. Patches the two .gyp files (`node_modules/node-pty/binding.gyp` and
REM      `node_modules/node-pty/deps/winpty/src/winpty.gyp`) to clear the
REM      SpectreMitigation attribute (sets it to '' instead of 'Spectre'),
REM      which drops the `/Qspectre` flag from MSBuild.
REM   2. Triggers `npm rebuild node-pty` so the native binaries are rebuilt
REM      against the patched gyp. `better-sqlite3` is also rebuilt via the
REM      root npm install hook.
REM
REM Idempotent: re-running the script is safe. If the patch is already
REM applied (SpectreMitigation empty), the gyp write is skipped.
REM
REM When to run:
REM   - After `npm ci` (root) finishes, since node-pty is installed under
REM     `node_modules/node-pty` but the build hook is intentionally skipped
REM     (`--ignore-scripts`) in environments without vcvars64 in PATH.
REM   - After any Node version upgrade (different ABI → must recompile).
REM   - After pulling upstream node-pty version bumps (gyp files reset).
REM
REM Required environment:
REM   - Node >= 24 (managed via fnm in PowerShell profile on this machine).
REM   - MSVC toolset (VS 2019/2022 Build Tools) discoverable via vcvars64.bat.
REM   - This script picks the VS 2022 Build Tools path on this machine. If
REM     you use a different VS install, edit VC_VARS below.
REM
REM Trade-off:
REM   Disabling Spectre mitigation trades a single optional CPU-side-channel
REM   defense for the ability to ship a working build without the optional
REM   Spectre libs component. This is acceptable for a local scientific tool
REM   that already runs untrusted R/Python code via the biof3 backend; it is
REM   NOT acceptable if biof3 ever ships as a service that processes
REM   untrusted external input at scale.
REM =============================================================================
setlocal

set REPO_ROOT=%~dp0..\..
pushd "%REPO_ROOT%"
if errorlevel 1 (
    echo [patch-node-pty-spectre] ERROR: cannot resolve repo root from %~dp0
    exit /b 1
)
set REPO_ROOT=%CD%
popd

REM Locate VS Build Tools (prefer 2022, fall back to 2019).
set VC_VARS=
if exist "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    set VC_VARS=C:\Program Files ^(x86^)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat
)
if "%VC_VARS%"=="" if exist "C:\Program Files (x86)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat" (
    set VC_VARS=C:\Program Files ^(x86^)\Microsoft Visual Studio\2019\BuildTools\VC\Auxiliary\Build\vcvars64.bat
)
if "%VC_VARS%"=="" (
    echo [patch-node-pty-spectre] ERROR: vcvars64.bat not found. Install VS 2019 or 2022 Build Tools with the C++ workload.
    exit /b 1
)

echo [patch-node-pty-spectre] Using VC vcvars64: %VC_VARS%
call "%VC_VARS%" >nul 2>&1
if errorlevel 1 (
    echo [patch-node-pty-spectre] ERROR: failed to activate vcvars64.bat
    exit /b 1
)
echo [patch-node-pty-spectre] cl:  !ERRORLEVEL!

cd /d "%REPO_ROOT%"

REM --- Patch node-pty gyp files (drop SpectreMitigation) ---
echo [patch-node-pty-spectre] Patching node-pty binding.gyp ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$f='node_modules/node-pty/binding.gyp'; if (Test-Path $f) { $c=[System.IO.File]::ReadAllText($f); if ($c -match \"'SpectreMitigation': 'Spectre'\") { $n=$c.Replace(\"'SpectreMitigation': 'Spectre'\", \"'SpectreMitigation': ''\"); [System.IO.File]::WriteAllText($f, $n, (New-Object System.Text.UTF8Encoding $false)); Write-Host '  binding.gyp patched' } else { Write-Host '  binding.gyp already clean' } } else { Write-Host '  binding.gyp not present (node-pty not installed)' }"
if errorlevel 1 (
    echo [patch-node-pty-spectre] ERROR: failed to patch binding.gyp
    exit /b 1
)

echo [patch-node-pty-spectre] Patching node-pty deps/winpty/src/winpty.gyp ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "$f='node_modules/node-pty/deps/winpty/src/winpty.gyp'; if (Test-Path $f) { $c=[System.IO.File]::ReadAllText($f); if ($c -match \"'SpectreMitigation': 'Spectre'\") { $n=$c.Replace(\"'SpectreMitigation': 'Spectre'\", \"'SpectreMitigation': ''\"); [System.IO.File]::WriteAllText($f, $n, (New-Object System.Text.UTF8Encoding $false)); Write-Host '  winpty.gyp patched' } else { Write-Host '  winpty.gyp already clean' } } else { Write-Host '  winpty.gyp not present (winpty subproject not extracted)' }"
if errorlevel 1 (
    echo [patch-node-pty-spectre] ERROR: failed to patch winpty.gyp
    exit /b 1
)

REM --- Rebuild native modules ---
echo [patch-node-pty-spectre] Rebuilding node-pty ...
call npm rebuild node-pty --no-audit --no-fund --foreground-scripts
if errorlevel 1 (
    echo [patch-node-pty-spectre] ERROR: node-pty rebuild failed
    exit /b 1
)

if exist "node_modules\better-sqlite3" (
    echo [patch-node-pty-spectre] Rebuilding better-sqlite3 ...
    call npm rebuild better-sqlite3 --no-audit --no-fund --foreground-scripts
    if errorlevel 1 (
        echo [patch-node-pty-spectre] WARNING: better-sqlite3 rebuild failed; abort
        exit /b 1
    )
)

echo [patch-node-pty-spectre] Done.
exit /b 0