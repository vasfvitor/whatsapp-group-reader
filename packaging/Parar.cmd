@echo off
setlocal
set "WGR_PKG=%~dp0"
echo Encerrando o WhatsApp Group Reader...
powershell -NoProfile -Command "$root = $env:WGR_PKG; Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'chrome.exe') -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
echo Pronto. Pode fechar esta janela.
pause
endlocal
