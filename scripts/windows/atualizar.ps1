# Atualiza o codigo, aplica migrations, refaz o build e reinicia.
$App = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $App
& "$PSScriptRoot\parar.ps1"
git pull --ff-only
npm ci
npm run db:generate
# Migrations precisam do Postgres no ar.
$Infra = Join-Path (Split-Path $App -Parent) "gollab-openreply-infra"
Start-Process -WindowStyle Hidden -FilePath "$Infra\pgsql\bin\pg_ctl.exe" `
  -ArgumentList "-D","`"$Infra\pgdata`"","-l","`"$Infra\logs\postgres.log`"","-o","`"-p 5433 -c listen_addresses=127.0.0.1`"","start"
Start-Sleep 6
npm run db:migrate
npm run build
& "$PSScriptRoot\iniciar.ps1"
