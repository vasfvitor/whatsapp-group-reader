#Requires -Version 7
<#
  Gera o pacote portátil para Windows (zip com Node + Chromium + app).
  Uso:  pnpm package:win   [-NodeVersion 24.14.0] [-SkipBuild] [-SkipSmokeTest]
  Saída: release/whatsapp-group-reader-win64-<versão>-<data>.zip
#>
[CmdletBinding()]
param(
  [string]$NodeVersion = '24.14.0',
  [string]$OutDir = 'release',
  [switch]$SkipBuild,
  [switch]$SkipSmokeTest
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

function Assert-Path([string]$p, [string]$why) {
  if (-not (Test-Path $p)) { throw "FALHA: $why — não encontrado: $p" }
}
function Step([string]$msg) { Write-Host "`n== $msg" -ForegroundColor Cyan }

# ---------------------------------------------------------------- 1. preflight
$rootPkg = Get-Content package.json -Raw | ConvertFrom-Json
$version = $rootPkg.version
if ($version -eq '0.0.0') { Write-Warning 'package.json ainda está em 0.0.0 — considere versionar antes de entregar.' }
$tag = "$version-$(Get-Date -Format yyyyMMdd)"
$baseName = "whatsapp-group-reader-win64-$tag"
Step "Empacotando versão $version (tag $tag)"

# ---------------------------------------------------------------- 2. build
if (-not $SkipBuild) {
  Step 'Build (pnpm install + pnpm build)'
  corepack pnpm install --frozen-lockfile
  if ($LASTEXITCODE -ne 0) { throw 'pnpm install falhou' }
  corepack pnpm build
  if ($LASTEXITCODE -ne 0) { throw 'pnpm build falhou' }
}
Assert-Path 'dist/web/index.html' 'frontend compilado'
Assert-Path 'dist/server/server/index.js' 'backend compilado'

# ---------------------------------------------------------------- 3. Node portátil (cache em vendor/)
Step "Node portátil v$NodeVersion"
$vendorDir = Join-Path $repo 'vendor'
$nodeDirName = "node-v$NodeVersion-win-x64"
$nodeDir = Join-Path $vendorDir $nodeDirName
if (-not (Test-Path (Join-Path $nodeDir 'node.exe'))) {
  New-Item -ItemType Directory -Force $vendorDir | Out-Null
  $nodeZip = Join-Path $vendorDir "$nodeDirName.zip"
  Write-Host "Baixando https://nodejs.org/dist/v$NodeVersion/$nodeDirName.zip"
  Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/$nodeDirName.zip" -OutFile $nodeZip
  $shasums = (Invoke-WebRequest "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt").Content
  $line = $shasums -split "`r?`n" | Where-Object { $_ -match "\s+$([regex]::Escape("$nodeDirName.zip"))\s*$" } | Select-Object -First 1
  if (-not $line) { throw "SHASUMS256.txt não lista $nodeDirName.zip" }
  $expected = ($line -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash $nodeZip -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "SHA-256 do Node não confere (esperado $expected, obtido $actual)" }
  Expand-Archive $nodeZip -DestinationPath $vendorDir -Force
  Remove-Item $nodeZip
}
$npmCli = Join-Path $nodeDir 'node_modules\npm\bin\npm-cli.js'
Assert-Path $npmCli 'npm dentro do Node vendorizado'

# ---------------------------------------------------------------- 4. staging
Step 'Staging'
$stagingRoot = Join-Path $repo 'build\staging'
$staging = Join-Path $stagingRoot $baseName
if (Test-Path $stagingRoot) { Remove-Item -Recurse -Force $stagingRoot }
$appDir = Join-Path $staging 'app'
New-Item -ItemType Directory -Force $appDir, (Join-Path $staging 'runtime') | Out-Null
Copy-Item 'dist\web' -Destination (Join-Path $appDir 'dist\web') -Recurse
Copy-Item 'dist\server' -Destination (Join-Path $appDir 'dist\server') -Recurse
Copy-Item (Join-Path $nodeDir 'node.exe') (Join-Path $staging 'runtime\node.exe')

$appPkg = Get-Content 'packaging\app-package.json' -Raw | ConvertFrom-Json
$appPkg.version = $version
$appPkg | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $appDir 'package.json') -Encoding utf8

$lockSource = 'packaging\package-lock.json'
if (Test-Path $lockSource) {
  $lock = Get-Content $lockSource -Raw | ConvertFrom-Json -AsHashtable
  $lock['version'] = $version
  if ($lock.ContainsKey('packages') -and $lock['packages'].ContainsKey('')) {
    $lock['packages']['']['version'] = $version
  }
  $lock | ConvertTo-Json -Depth 100 | Set-Content (Join-Path $appDir 'package-lock.json') -Encoding utf8
}

# ------------------------------------------- 5. npm install com o node.exe DO PACOTE
# Rodar o npm sob o node.exe distribuído garante que o prebuild-install baixe o
# better_sqlite3.node do ABI certo, e o postinstall do puppeteer coloca o Chrome
# direto no cache do pacote.
Step 'Dependências de produção (npm sob o runtime distribuído)'
$nodeExe = Join-Path $staging 'runtime\node.exe'
# O cache do Chromium fica em vendor/ (como o Node) para não rebaixar ~180 MB a cada
# build — o postinstall do puppeteer só baixa se a revisão pedida não estiver no cache.
# Após um bump do puppeteer, revisões antigas podem ser apagadas de vendor/chromium.
$chromiumCache = Join-Path $vendorDir 'chromium'
$env:PUPPETEER_CACHE_DIR = $chromiumCache
$env:PUPPETEER_CHROME_HEADLESS_SHELL_SKIP_DOWNLOAD = 'true'
$npmCmd = (Test-Path (Join-Path $appDir 'package-lock.json')) ? 'ci' : 'install'
Push-Location $appDir
try {
  # --ignore-scripts=false: os postinstalls (prebuild do better-sqlite3, download do
  # Chrome pelo puppeteer) são indispensáveis aqui, mesmo se o .npmrc do usuário os desligar.
  & $nodeExe $npmCli $npmCmd --omit=dev --no-audit --no-fund --ignore-scripts=false
  if ($LASTEXITCODE -ne 0) { throw "npm $npmCmd falhou" }
} finally { Pop-Location }
if ($npmCmd -eq 'install') {
  Copy-Item (Join-Path $appDir 'package-lock.json') $lockSource
  Write-Warning 'packaging/package-lock.json foi gerado — faça commit dele para builds reproduzíveis.'
}

# Correção do PR wwebjs#201850 (rename _serialized -> $1 no WhatsApp Web) — ver scripts/patch-wwebjs.mjs
& $nodeExe (Join-Path $repo 'scripts\patch-wwebjs.mjs') (Join-Path $appDir 'node_modules')
if ($LASTEXITCODE -ne 0) { throw 'patch-wwebjs falhou no staging' }

# Copiar apenas o Chrome (nunca o chrome-headless-shell) do cache para o pacote
$chromeSrc = Join-Path $chromiumCache 'chrome'
Assert-Path $chromeSrc 'Chrome baixado pelo postinstall do puppeteer'
if (Test-Path (Join-Path $chromiumCache 'chrome-headless-shell')) {
  Write-Warning 'chrome-headless-shell apareceu no cache (flag de skip regrediu) — não será incluído no pacote.'
}
New-Item -ItemType Directory -Force (Join-Path $staging 'chromium') | Out-Null
Copy-Item $chromeSrc -Destination (Join-Path $staging 'chromium') -Recurse

# ---------------------------------------------------------------- 6. verificação (falhar cedo)
Step 'Verificação do staging'
Assert-Path (Join-Path $appDir 'node_modules\better-sqlite3\build\Release\better_sqlite3.node') 'prebuild do better-sqlite3'
$chrome = Get-ChildItem (Join-Path $staging 'chromium') -Recurse -Filter 'chrome.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $chrome) { throw 'FALHA: chrome.exe não encontrado no chromium do pacote' }
$stagedPkg = Get-Content (Join-Path $appDir 'package.json') -Raw | ConvertFrom-Json
if ($stagedPkg.type -ne 'module') { throw 'FALHA: app/package.json sem "type": "module" — o servidor ESM não carregaria' }

# Sonda de ABI: instancia o better-sqlite3 com o node.exe que vai no pacote.
Push-Location $appDir
try {
  & $nodeExe -e "const{createRequire}=require('node:module');const D=createRequire(process.cwd()+'/probe.cjs')('better-sqlite3');new D(':memory:').close();console.log('better-sqlite3 OK no ABI do runtime distribuido')"
  if ($LASTEXITCODE -ne 0) { throw 'FALHA: better-sqlite3 incompatível com o node.exe distribuído (ABI)' }
} finally { Pop-Location }

$reparse = Get-ChildItem (Join-Path $appDir 'node_modules') -Recurse -Force -Attributes ReparsePoint -ErrorAction SilentlyContinue
if ($reparse) { throw "FALHA: node_modules contém links/junctions (não sobrevivem ao zip): $($reparse[0].FullName)" }

# ---------------------------------------------------------------- 7. poda
Step 'Poda (packaging/prune.txt)'
$before = (Get-ChildItem $staging -Recurse -File | Measure-Object Length -Sum).Sum
foreach ($rawLine in Get-Content 'packaging\prune.txt') {
  $entry = $rawLine.Trim()
  if (-not $entry -or $entry.StartsWith('#')) { continue }
  if ($entry.StartsWith('**/')) {
    $filter = $entry.Substring(3)
    $dirOnly = $filter.EndsWith('/')
    if ($dirOnly) { $filter = $filter.TrimEnd('/') }
    $base = Join-Path $appDir 'node_modules'
    $found = Get-ChildItem $base -Recurse -Force -Filter $filter -ErrorAction SilentlyContinue |
      Where-Object { -not $dirOnly -or $_.PSIsContainer }
    $found | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  } else {
    $target = Join-Path $staging $entry
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
  }
}
$after = (Get-ChildItem $staging -Recurse -File | Measure-Object Length -Sum).Sum
Write-Host ("Poda: {0:N0} MB -> {1:N0} MB" -f ($before / 1MB), ($after / 1MB))

# ---------------------------------------------------------------- 8. arquivos do cliente
Step 'Arquivos do cliente'
Copy-Item 'packaging\Iniciar.cmd' $staging
Copy-Item 'packaging\Parar.cmd' $staging
# UTF-8 com BOM para o Notepad renderizar acentos ao dar dois cliques
Get-Content 'packaging\README-CLIENTE.txt' -Raw |
  Set-Content (Join-Path $staging 'README-CLIENTE.txt') -Encoding utf8BOM -NoNewline

# ---------------------------------------------------------------- 9. smoke test
if (-not $SkipSmokeTest) {
  Step 'Smoke test (perfil de dados isolado em %TEMP%)'
  $portBusy = $false
  try {
    $tcp = [System.Net.Sockets.TcpClient]::new()
    $tcp.Connect('127.0.0.1', 3210)
    $portBusy = $tcp.Connected
    $tcp.Dispose()
  } catch { <# porta livre — esperado #> }
  if ($portBusy) { throw 'FALHA: a porta 3210 já está em uso — feche a instância antes de empacotar (ou use -SkipSmokeTest)' }

  $sandbox = Join-Path $env:TEMP "wgr-smoke-$([guid]::NewGuid().ToString('N'))"
  New-Item -ItemType Directory $sandbox | Out-Null
  $outLog = Join-Path $sandbox 'smoke-stdout.log'
  $errLog = Join-Path $sandbox 'smoke-stderr.log'
  function Show-SmokeLogs {
    foreach ($log in @($outLog, $errLog)) {
      if ((Test-Path $log) -and (Get-Item $log).Length -gt 0) {
        Write-Host "--- $(Split-Path -Leaf $log) (últimas linhas) ---"
        Get-Content $log -Tail 40 | Write-Host
      }
    }
  }
  $chromiumStaged = Join-Path $staging 'chromium'
  $oldLocal = $env:LOCALAPPDATA; $oldRoaming = $env:APPDATA; $oldPptrCache = $env:PUPPETEER_CACHE_DIR
  $proc = $null
  try {
    # env-paths deriva tudo de LOCALAPPDATA — redirecionar isola os dados do smoke test.
    # PUPPETEER_CACHE_DIR aponta para o chromium DO PACOTE, como o Iniciar.cmd fará.
    $env:LOCALAPPDATA = $sandbox; $env:APPDATA = $sandbox
    $env:PUPPETEER_CACHE_DIR = $chromiumStaged
    Write-Host 'Iniciando o app empacotado (uma aba do navegador vai abrir — pode fechar)…'
    $proc = Start-Process $nodeExe -ArgumentList 'dist\server\server\index.js' -WorkingDirectory $appDir `
      -PassThru -NoNewWindow -RedirectStandardOutput $outLog -RedirectStandardError $errLog
  } finally {
    $env:LOCALAPPDATA = $oldLocal; $env:APPDATA = $oldRoaming; $env:PUPPETEER_CACHE_DIR = $oldPptrCache
  }

  try {
    $status = $null
    foreach ($i in 1..30) {
      if ($proc.HasExited) { Show-SmokeLogs; throw "FALHA: o processo terminou sozinho (código $($proc.ExitCode))" }
      try { $status = Invoke-RestMethod 'http://127.0.0.1:3210/api/status' -TimeoutSec 2; break }
      catch [Microsoft.PowerShell.Commands.HttpResponseException] {
        # o servidor subiu, mas respondeu com erro — não é o mesmo que "ainda não subiu"
        Show-SmokeLogs
        throw "FALHA: /api/status respondeu HTTP $([int]$_.Exception.Response.StatusCode)"
      }
      catch { Start-Sleep 2 }
    }
    if (-not $status) { Show-SmokeLogs; throw 'FALHA: /api/status não respondeu em 60s' }
    if (-not $status.dataDirectory.StartsWith($sandbox)) {
      throw "FALHA: dados foram para '$($status.dataDirectory)' em vez do sandbox — env-paths não respeitou LOCALAPPDATA"
    }
    Write-Host "HTTP OK; dados isolados em $($status.dataDirectory)"

    # comparação por StartsWith, não -like: colchetes no caminho quebrariam o curinga
    $chromeProc = $null
    foreach ($i in 1..45) {
      $chromeProc = Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
        Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($chromiumStaged, [System.StringComparison]::OrdinalIgnoreCase) } |
        Select-Object -First 1
      if ($chromeProc) { break }
      Start-Sleep 2
    }
    if (-not $chromeProc) { Show-SmokeLogs; throw 'FALHA: nenhum chrome.exe do pacote foi iniciado em 90s (resolução do navegador errada?)' }
    Write-Host "Chrome do pacote em execução: $($chromeProc.ExecutablePath)"
  } finally {
    $doomed = @()
    if ($proc -and -not $proc.HasExited) {
      $doomed += $proc
      Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
    }
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" |
      Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($staging, [System.StringComparison]::OrdinalIgnoreCase) } |
      ForEach-Object {
        $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
        if ($p) { $doomed += $p; Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
      }
    # esperar de verdade: um chrome morrendo devagar travaria o zip ou o próximo build
    $doomed | Wait-Process -Timeout 15 -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $sandbox -ErrorAction SilentlyContinue
  }
  Write-Host 'Smoke test OK' -ForegroundColor Green
}

# ---------------------------------------------------------------- 10. zip
Step 'Zip'
New-Item -ItemType Directory -Force $OutDir | Out-Null
$zipPath = Join-Path (Resolve-Path $OutDir) "$baseName.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }
Add-Type -AssemblyName System.IO.Compression.FileSystem
# includeBaseDirectory:$false — o "Extrair tudo" do Explorer já cria uma pasta com o
# nome do zip; uma pasta-base dentro do arquivo dobraria o aninhamento e contrariaria
# as instruções do README-CLIENTE.txt.
[IO.Compression.ZipFile]::CreateFromDirectory($staging, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)

$size = (Get-Item $zipPath).Length
$hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash
Write-Host ''
Write-Host "Pacote:  $zipPath" -ForegroundColor Green
Write-Host ("Tamanho: {0:N0} MB" -f ($size / 1MB)) -ForegroundColor Green
Write-Host "SHA-256: $hash" -ForegroundColor Green
