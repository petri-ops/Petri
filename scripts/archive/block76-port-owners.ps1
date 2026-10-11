$c = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c) {
  $p = Get-Process -Id $c.OwningProcess
  Write-Output ("port3001 pid=" + $p.Id + " name=" + $p.ProcessName + " start=" + $p.StartTime.ToString("yyyy-MM-dd HH:mm:ss"))
} else {
  Write-Output "port3001 no-listener"
}
$c2 = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($c2) {
  $p2 = Get-Process -Id $c2.OwningProcess
  Write-Output ("port3000 pid=" + $p2.Id + " name=" + $p2.ProcessName + " start=" + $p2.StartTime.ToString("yyyy-MM-dd HH:mm:ss"))
} else {
  Write-Output "port3000 no-listener"
}
$e = Get-Process electron -ErrorAction SilentlyContinue
if ($e) { Write-Output ("electron procs=" + @($e).Count + " start=" + (@($e)[0].StartTime.ToString("yyyy-MM-dd HH:mm:ss"))) } else { Write-Output "electron none" }
