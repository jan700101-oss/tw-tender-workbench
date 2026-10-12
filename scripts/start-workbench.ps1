[CmdletBinding()]
param([switch]$NoBrowser, [string]$AssistantRoot)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $AssistantRoot) { $AssistantRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $projectRoot)) '2026-06-22\ai-tender-document-assistant' }
$url = 'http://127.0.0.1:8796/tenders/'
$ready = $false
try { $health = Invoke-RestMethod 'http://127.0.0.1:8796/api/health' -TimeoutSec 3; $ready = $health.ok -eq $true } catch {}
if (-not $ready) {
    if (-not (Test-Path -LiteralPath (Join-Path $assistantRoot 'dist\index.html'))) { throw 'Document assistant is not built. Run npm run build in the assistant directory.' }
    $env:PORT = '8796'
    $env:TENDER_DESK_PATH = Join-Path $projectRoot 'docs'
    $node = (Get-Command node).Source
    $logFolder = Join-Path $projectRoot 'outputs'
    Start-Process -FilePath $node -ArgumentList @('server/index.js') -WorkingDirectory $assistantRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logFolder 'integrated-workbench.log') -RedirectStandardError (Join-Path $logFolder 'integrated-workbench-error.log') | Out-Null
    for ($i=0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 500
        try { $health = Invoke-RestMethod 'http://127.0.0.1:8796/api/health' -TimeoutSec 2; if ($health.ok) { $ready = $true; break } } catch {}
    }
}
if (-not $ready) { throw 'Startup failed. See outputs/integrated-workbench-error.log.' }
if (-not $NoBrowser) { Start-Process "$env:WINDIR\System32\rundll32.exe" -ArgumentList @('url.dll,FileProtocolHandler', $url) -WindowStyle Hidden }
Write-Output "Integrated workbench is ready: $url"
