# ============================================================
# setup-windows-ssh-node.ps1  (BLOCK-85 direction B)
# One-time setup so the Mac's Petri can SSH into this Windows
# machine as an execution node. Run from an ELEVATED PowerShell.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup-windows-ssh-node.ps1
#
# What it does:
#   1. Install OpenSSH Server (Windows optional capability) if missing
#   2. Start sshd + set it to auto-start
#   3. Open firewall rule for inbound port 22
#   4. Set sshd DefaultShell to Git Bash (bash.exe) - the Petri
#      node-side runner speaks POSIX shell
#   5. Prepare C:\ProgramData\ssh\administrators_authorized_keys
#      (mandatory pubkey path for admin-group users on Windows OpenSSH)
#   6. Print the connection info the Mac side needs (IP + username)
# All comments ASCII-only on purpose (PowerShell 5.1 GBK parsing).
# ============================================================

$ErrorActionPreference = 'Stop'

function Step($msg) { Write-Host "[setup] $msg" }

# --- 1. OpenSSH Server capability ---
$sshd = Get-WindowsCapability -Online -Name 'OpenSSH.Server*' 2>$null
if ($sshd -and $sshd.State -ne 'Installed') {
    Step 'Installing OpenSSH.Server capability (may take a minute)...'
    Add-WindowsCapability -Online -Name $sshd.Name | Out-Null
} elseif ($sshd) {
    Step 'OpenSSH Server already installed.'
} else {
    Step 'Get-WindowsCapability unavailable (Server SKU?) - trying Add-WindowsFeature.'
    Add-WindowsFeature OpenSSH-Server 2>$null | Out-Null
}

# --- 2. sshd service up + auto ---
Set-Service -Name sshd -StartupType Automatic
Start-Service sshd
Step 'sshd service running.'

# --- 3. Firewall rule ---
if (-not (Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' `
        -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
    Step 'Firewall rule created for port 22.'
} else {
    Step 'Firewall rule already present.'
}

# --- 4. DefaultShell -> Git Bash (POSIX-compatible for the node runner) ---
$gitBash = $null
$gitExe = (Get-Command git.exe -ErrorAction SilentlyContinue).Source
if ($gitExe) {
    # git.exe lives at <root>\cmd\git.exe or <root>\mingw64\bin\git.exe
    $gitRoot = Split-Path (Split-Path $gitExe -Parent) -Parent
    foreach ($rel in @('bin\bash.exe', 'usr\bin\bash.exe')) {
        $candidate = Join-Path $gitRoot $rel
        if (Test-Path $candidate) { $gitBash = $candidate; break }
    }
}
if (-not $gitBash) {
    $bashCandidates = @(
        "$env:ProgramFiles\Git\bin\bash.exe",
        "${env:ProgramFiles(x86)}\Git\bin\bash.exe",
        "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe"
    )
    $gitBash = $bashCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if ($gitBash) {
    New-ItemProperty -Path 'HKLM:\SOFTWARE\OpenSSH' -Name DefaultShell `
        -Value $gitBash -PropertyType String -Force | Out-Null
    Step "DefaultShell set to $gitBash"
} else {
    Write-Warning 'Git Bash not found - DefaultShell left as-is. Install Git for Windows first; the Petri runner needs POSIX bash.'
}

# --- 5. administrators_authorized_keys ready to receive the Mac pubkey ---
$adminKeys = 'C:\ProgramData\ssh\administrators_authorized_keys'
if (-not (Test-Path $adminKeys)) {
    New-Item -Path $adminKeys -ItemType File -Force | Out-Null
}
# Required ACL: Administrators + SYSTEM only, no inheritance.
icacls $adminKeys /inheritance:r /grant 'Administrators:F' /grant 'SYSTEM:F' | Out-Null
Step "authorized-keys file ready: $adminKeys"
Step 'After generating a key on the Mac, append its .pub line into that file, then restart sshd:'

# --- 6. Connection info for the Mac side ---
$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike '169.254*' -and $_.IPAddress -ne '127.0.0.1' } |
    Select-Object -First 1).IPAddress
Write-Host ''
Write-Host '==================== GIVE THESE TO THE MAC SIDE ===================='
Write-Host "Windows LAN IP : $ip"
Write-Host "Windows user   : $env:USERNAME"
Write-Host "sshd port      : 22 (DefaultShell = bash)"
Write-Host 'Mac ~/.ssh/config entry:'
Write-Host "  Host petri-windows"
Write-Host "    HostName $ip"
Write-Host "    Port 22"
Write-Host "    User $env:USERNAME"
Write-Host 'Then on the Mac:  ssh-keygen -t ed25519 (if no key) and give the'
Write-Host 'administrator of this machine the .pub line to append into'
Write-Host "$adminKeys"
Write-Host '===================================================================='
