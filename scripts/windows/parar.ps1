# Para tudo que o iniciar.ps1 subiu.
$App   = Resolve-Path "$PSScriptRoot\..\.."
$Infra = Join-Path (Split-Path $App -Parent) "gollab-openreply-infra"

# Supervisor do worker primeiro (para nao reiniciar o worker), depois o
# proprio worker e o receptor de e-mail.
$patterns = @("*worker-supervisor.mjs*", "*npm run worker*", "*worker/dm-worker.ts*", "*dev-mail-sink.mjs*")
Get-CimInstance Win32_Process | Where-Object {
  $cmd = $_.CommandLine
  $cmd -and ($patterns | Where-Object { $cmd -like $_ })
} | Sort-Object { if ($_.CommandLine -like "*worker-supervisor.mjs*") { 0 } else { 1 } } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }

# Next em producao escuta a 3000: encerra quem estiver nela.
Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force -ErrorAction Stop } catch {} }

# Túnel fixo (o temporário do tunel.ps1 não é tocado).
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -like "*config.yml*" } |
  ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }

& "$Infra\memurai\Memurai\memurai-cli.exe" -p 6380 shutdown 2>$null | Out-Null
& "$Infra\pgsql\bin\pg_ctl.exe" -D "$Infra\pgdata" stop -m fast 2>$null | Out-Null
Write-Host "Tudo parado."
