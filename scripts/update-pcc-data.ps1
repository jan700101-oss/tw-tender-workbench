[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataPath = Join-Path $projectRoot 'docs\data\open-tenders.json'
$validationPath = Join-Path $projectRoot 'docs\data\open-tenders-validation.json'
$indexPath = Join-Path $projectRoot 'docs\index.html'
$logDirectory = Join-Path $projectRoot 'outputs'
$logPath = Join-Path $logDirectory 'pcc-update.log'
$backupDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("tw-tender-workbench-" + [Guid]::NewGuid().ToString('N'))

New-Item -ItemType Directory -Path $backupDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

function Write-UpdateLog {
    param([string]$Message)
    $timestamp = [DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz', [Globalization.CultureInfo]::InvariantCulture)
    Add-Content -LiteralPath $logPath -Value "$timestamp $Message" -Encoding UTF8
}

function Invoke-NodeScript {
    param([string]$RelativePath)
    & node --use-system-ca (Join-Path $projectRoot $RelativePath)
    if ($LASTEXITCODE -ne 0) {
        throw "node $RelativePath failed (exit $LASTEXITCODE)"
    }
}

try {
    foreach ($path in @($dataPath, $validationPath, $indexPath)) {
        if (Test-Path -LiteralPath $path) {
            Copy-Item -LiteralPath $path -Destination (Join-Path $backupDirectory ([IO.Path]::GetFileName($path))) -Force
        }
    }

    Push-Location $projectRoot
    try {
        Invoke-NodeScript 'scripts\sync-open-tenders.mjs'
        Invoke-NodeScript 'scripts\validate-open-tenders.mjs'
    }
    finally {
        Pop-Location
    }

    $payload = Get-Content -LiteralPath $dataPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $report = Get-Content -LiteralPath $validationPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $report.passed) { throw 'Data validation failed' }
    if ([int]$payload.count -le 0 -or @($payload.records).Count -ne [int]$payload.count) {
        throw 'Record count is zero or inconsistent'
    }
    if ([string]::IsNullOrWhiteSpace([string]$payload.generatedAt)) {
        throw 'Missing generatedAt timestamp'
    }

    $version = [DateTimeOffset]::Now.ToString('yyyyMMddHHmm', [Globalization.CultureInfo]::InvariantCulture)
    $html = Get-Content -LiteralPath $indexPath -Raw -Encoding UTF8
    $replacement = '${1}' + $version
    $html = [regex]::Replace($html, '(styles\.css\?v=)\d+', $replacement)
    $html = [regex]::Replace($html, '(app\.js\?v=)\d+', $replacement)
    [IO.File]::WriteAllText($indexPath, $html, (New-Object Text.UTF8Encoding($false)))

    Write-UpdateLog "Update succeeded: $($payload.count) open tenders; generatedAt=$($payload.generatedAt); official sample=$($report.officialRowsPassed)/$($report.officialRowsRequested)."
    Write-Output "PCC update succeeded: $($payload.count) open tenders; generatedAt=$($payload.generatedAt)"
}
catch {
    foreach ($path in @($dataPath, $validationPath, $indexPath)) {
        $backup = Join-Path $backupDirectory ([IO.Path]::GetFileName($path))
        if (Test-Path -LiteralPath $backup) {
            Copy-Item -LiteralPath $backup -Destination $path -Force
        }
    }
    Write-UpdateLog "Update failed: $($_.Exception.Message); previous data restored."
    Write-Error $_.Exception.Message
    exit 1
}
finally {
    if (Test-Path -LiteralPath $backupDirectory) {
        Remove-Item -LiteralPath $backupDirectory -Recurse -Force
    }
}
