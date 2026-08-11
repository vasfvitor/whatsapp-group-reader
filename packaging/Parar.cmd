@echo off
setlocal
set "WGR_PKG=%~dp0"
echo Encerrando o WhatsApp Group Reader...
powershell -NoProfile -Command "$root = $env:WGR_PKG; Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) -or ($_.Name -eq 'msedge.exe' -and $_.CommandLine -and $_.CommandLine.Contains('whatsapp-group-reader')) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Pronto. Pode fechar esta janela.
pause
endlocal
