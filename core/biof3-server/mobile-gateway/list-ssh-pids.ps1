param([string]$Signature)
Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | ForEach-Object {
    if ($_.CommandLine -like ("*" + $Signature + "*")) { Write-Output $_.ProcessId }
}
