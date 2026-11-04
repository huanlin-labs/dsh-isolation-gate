<#
  push-with-retry.ps1  -  retry git push on transient network failures.
  Usage:
    pwsh -File tools/push-with-retry.ps1            # push main + tags
    pwsh -File tools/push-with-retry.ps1 -DryRun    # probe only, never pushes
  Exit codes: 0 ok / 2 auth-or-permission (do NOT retry) / 3 still failing after N tries
#>
param(
  [int]$MaxTries = 5,
  [int]$BaseDelaySec = 3,
  [string]$Remote = 'origin',
  [string]$Branch = 'main',
  [string]$Tag = 'v1.13.7',
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
function Git { param([string[]]$Args) & git @Args 2>&1 }

$transient = 'RPC failed|unexpected disconnect|Connection reset|Could not resolve host|Failed to connect|early EOF|HTTP 5\d\d|timed out'
$fatal     = 'HTTP 403|403 Forbidden|Permission denied|Authentication failed|not authorized|could not read Username'

for ($i = 1; $i -le $MaxTries; $i++) {
  if ($DryRun) {
    Write-Host "[dry-run] would run: git push $Remote $Branch ; git push $Remote $Tag"
    $probe = Git @('rev-list','--left-right','--count',"$Remote/$Branch...$Branch")
    Write-Host "[dry-run] ahead/behind = $probe"
    exit 0
  }

  Write-Host "=== attempt $i/$MaxTries : push $Branch ==="
  $out = (Git @('push',$Remote,$Branch)) -join "`n"
  Write-Host $out
  if ($LASTEXITCODE -eq 0) {
    Write-Host "=== push $Tag ==="
    $out2 = (Git @('push',$Remote,$Tag)) -join "`n"
    Write-Host $out2
    if ($LASTEXITCODE -eq 0) { Write-Host 'OK: branch + tag pushed'; exit 0 }
    else {
      if ($out2 -match $fatal) { Write-Host 'STOP: permission/auth problem on tag push (not retryable)'; exit 2 }
    }
  }
  else {
    if ($out -match $fatal) { Write-Host 'STOP: permission/auth problem (not retryable). Fix repo write access first.'; exit 2 }
    if ($out -notmatch $transient) { Write-Host 'STOP: non-transient error'; exit 3 }
  }

  $delay = $BaseDelaySec * [math]::Pow(2, $i - 1)
  Write-Host "transient failure, retrying in $delay s ..."
  Start-Sleep -Seconds $delay
}

Write-Host "FAILED after $MaxTries attempts"
exit 3
