# Abre um túnel HTTPS grátis da Cloudflare (sem conta) para o painel local,
# só para o TESTE REAL com a Meta antes de ter servidor. A URL muda a cada
# execução: atualize NEXTAUTH_URL no .env e as duas URLs no Meta Developers.
#   powershell -ExecutionPolicy Bypass -File scripts\windows\tunel.ps1
$App   = Resolve-Path "$PSScriptRoot\..\.."
$Infra = Join-Path (Split-Path $App -Parent) "gollab-openreply-infra"
$Exe   = Join-Path $Infra "cloudflared\cloudflared.exe"
$Log   = Join-Path $Infra "logs\tunel.log"
if (-not (Test-Path $Exe)) { Write-Host "cloudflared nao encontrado em $Exe"; exit 1 }
Remove-Item $Log -ErrorAction SilentlyContinue
Start-Process -WindowStyle Hidden -FilePath $Exe -ArgumentList "tunnel","--no-autoupdate","--url","http://localhost:3000","--logfile","`"$Log`""
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep 1
  $m = if (Test-Path $Log) { Select-String -Path $Log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" | Select-Object -First 1 } else { $null }
  if ($m) { break }
}
if (-not $m) { Write-Host "Nao consegui obter a URL; veja $Log"; exit 1 }
$url = $m.Matches[0].Value
Write-Host ""
Write-Host "URL publica: $url"
Write-Host ""
Write-Host "1) No .env:              NEXTAUTH_URL=$url   (depois rode parar.ps1 e iniciar.ps1)"
Write-Host "2) Meta > Webhooks:      $url/api/webhook"
Write-Host "3) Meta > Redirect OAuth: $url/api/instagram/callback"
Write-Host ""
Write-Host "Para fechar o tunel: Stop-Process -Name cloudflared"
