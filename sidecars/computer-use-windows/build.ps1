# BLOCK-63 P1 — Windows 电脑控制 sidecar 构建脚本。
# 产物：bin/publish/gewu-computer-use-windows.exe（自包含单文件，不入 git）。
# 前置：.NET 8 SDK（本机为用户级安装：dotnet-install -Channel 8.0）。
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
dotnet publish $here -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true `
  -o (Join-Path $here 'bin\publish')
dotnet publish (Join-Path $here 'axfixture') -c Release -r win-x64 --self-contained true `
  -p:PublishSingleFile=true -o (Join-Path $here 'axfixturein\publish')
Write-Host 'published -> sidecars/computer-use-windows/bin/publish/gewu-computer-use-windows.exe'
Write-Host 'published -> sidecars/computer-use-windows/axfixture/bin/publish/axfixture-windows.exe'
