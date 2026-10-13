# Inicia o OpenReply do GOL LAB localmente (Windows, sem Docker e sem admin):
# PostgreSQL portátil (porta 5433), Memurai/Redis (6380), receptor de e-mail
# de login (2525), web (3000) e worker com reinício automático se cair.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\iniciar.ps1
$ErrorActionPreference = "Stop"
$App   = Resolve-Path "$PSScriptRoot\..\.."
$Infra = Join-Path (Split-Path $App -Parent) "gollab-openreply-infra"
$Logs  = Join-Path $Infra "logs"
New-Item -ItemType Directory -Force $Logs | Out-Null

function Test-Port($port) {
  $c = New-Object Net.Sockets.TcpClient
  try { $c.Connect("127.0.0.1", $port); $true } catch { $false } finally { $c.Close() }
}

if (-not (Test-Port 5433)) {
  # Em segundo plano: chamado direto, o PowerShell fica preso esperando a
  # saida do processo do banco, que herda o console e nunca termina.
  Start-Process -WindowStyle Hidden -FilePath "$Infra\pgsql\bin\pg_ctl.exe" `
    -ArgumentList "-D","`"$Infra\pgdata`"","-l","`"$Logs\postgres.log`"","-o","`"-p 5433 -c listen_addresses=127.0.0.1`"","start"
  for ($i = 0; $i -lt 30 -and -not (Test-Port 5433); $i++) { Start-Sleep 1 }
  Write-Host "PostgreSQL iniciado (5433)"
} else { Write-Host "PostgreSQL ja estava rodando" }

if (-not (Test-Port 6380)) {
  Start-Process -WindowStyle Hidden -FilePath "$Infra\memurai\Memurai\memurai.exe" `
    -ArgumentList "--port","6380","--bind","127.0.0.1","--dir","$Infra\redis-data","--appendonly","yes","--maxmemory-policy","noeviction" `
    -RedirectStandardOutput "$Logs\redis.log" -RedirectStandardError "$Logs\redis.err.log"
  Write-Host "Memurai/Redis iniciado (6380)"
} else { Write-Host "Redis ja estava rodando" }

Set-Location $App
if (-not (Test-Port 2525)) {
  Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "scripts/dev-mail-sink.mjs" -WorkingDirectory $App `
    -RedirectStandardOutput "$Logs\mail.log" -RedirectStandardError "$Logs\mail.err.log"
  Write-Host "Receptor de e-mail local iniciado (2525)"
}

if (-not (Test-Path "$App\.next\BUILD_ID")) {
  Write-Host "Primeiro build do painel (alguns minutos)..."
  npm run build | Out-File "$Logs\build.log"
}

if (-not (Test-Port 3000)) {
  Start-Process -WindowStyle Hidden -FilePath "cmd.exe" -ArgumentList "/c","npm run start > `"$Logs\web.log`" 2>&1" -WorkingDirectory $App
  Write-Host "Painel iniciado: http://localhost:3000"
}

# Worker com supervisor (scripts/windows/worker-supervisor.mjs): se cair,
# volta em 5 s.
$existing = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*worker-supervisor.mjs*" }
if (-not $existing) {
  Start-Process -WindowStyle Hidden -FilePath "node" -ArgumentList "scripts/windows/worker-supervisor.mjs","`"$Logs\worker.log`"" -WorkingDirectory $App
  Write-Host "Worker iniciado (com reinicio automatico)"
} else { Write-Host "Worker ja estava rodando" }

Start-Sleep 8
try { (Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/health -TimeoutSec 20).Content } catch { Write-Host "Painel ainda subindo; veja $Logs\web.log" }
