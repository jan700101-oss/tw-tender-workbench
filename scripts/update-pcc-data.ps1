param(
  [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$sourceUrl = "https://web.pcc.gov.tw/tps/tp/OpenData/showList"
$downloadBase = "https://web.pcc.gov.tw/tps/tp/OpenData/downloadFile?fileName="
$outputDir = Join-Path $ProjectRoot "outputs"
$cacheDir = Join-Path $ProjectRoot ".cache\pcc"
$docsDir = Join-Path $ProjectRoot "docs"
$targetPath = Join-Path $outputDir "pcc-candidates.js"
$publicTargetPath = Join-Path $docsDir "pcc-candidates.js"
$indexPath = Join-Path $outputDir "index.html"
$publicIndexPath = Join-Path $docsDir "index.html"
$tempPath = Join-Path $outputDir "pcc-candidates.tmp.js"
$logPath = Join-Path $outputDir "pcc-update.log"

New-Item -ItemType Directory -Force -Path $cacheDir | Out-Null
New-Item -ItemType Directory -Force -Path $docsDir | Out-Null

function Write-Log([string]$Message) {
  $timestamp = [datetime]::Now.ToString("yyyy-MM-dd HH:mm:ss zzz", [Globalization.CultureInfo]::InvariantCulture)
  $line = "$timestamp $Message"
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  Write-Output $line
}

try {
  $listPath = Join-Path $cacheDir "showList.html"
  & curl.exe --ssl-no-revoke -sS -L -A "Mozilla/5.0" $sourceUrl -o $listPath
  if ($LASTEXITCODE -ne 0) { throw "政府公開資料下載頁連線失敗。" }

  $html = Get-Content -Raw -Encoding UTF8 $listPath
  $fileNames = [regex]::Matches($html, 'tender_\d{8}\.xml') |
    ForEach-Object { $_.Value } |
    Select-Object -Unique -First 8
  if (-not $fileNames -or $fileNames.Count -eq 0) { throw "找不到政府招標 XML 檔案。" }

  $rows = @()
  $cutoff = (Get-Date).Date.AddMonths(-3)
  foreach ($fileName in $fileNames) {
    $xmlPath = Join-Path $cacheDir $fileName
    & curl.exe --ssl-no-revoke -sS -L -A "Mozilla/5.0" "$downloadBase$fileName" -o $xmlPath
    if ($LASTEXITCODE -ne 0) { throw "下載 $fileName 失敗。" }

    [xml]$xml = Get-Content -Raw -Encoding UTF8 $xmlPath
    foreach ($tender in $xml.TENDER_LIST.TENDER) {
      if ([string]$tender.PROCUREMENT_ATTR -ne "工程類") { continue }
      $announcementDate = [datetime]::ParseExact([string]$tender.TENDER_SPDT, "yyyy/MM/dd", [Globalization.CultureInfo]::InvariantCulture)
      if ($announcementDate -lt $cutoff) { continue }
      $rows += [pscustomobject]@{
        date = $announcementDate.ToString("yyyy-MM-dd", [Globalization.CultureInfo]::InvariantCulture)
        agency = [string]$tender.TENDER_ORG_NAME
        caseNo = [string]$tender.TENDER_CASE_NO
        title = [string]$tender.TENDER_NAME
        method = [string]$tender.PROCUREMENT_TYPE
        attr = [string]$tender.PROCUREMENT_ATTR
        sourceFile = $fileName
      }
    }
  }

  $deduped = $rows |
    Group-Object { "$($_.agency)|$($_.caseNo)|$($_.title)" } |
    ForEach-Object { $_.Group | Sort-Object date -Descending | Select-Object -First 1 } |
    Sort-Object date -Descending
  if (-not $deduped -or $deduped.Count -eq 0) { throw "近三個月沒有可寫入的工程類公告。" }

  $latestDate = ($deduped | Sort-Object date -Descending | Select-Object -First 1).date
  $meta = [ordered]@{
    updatedAt = [datetime]::Now.ToString("yyyy-MM-ddTHH:mm:sszzz", [Globalization.CultureInfo]::InvariantCulture)
    latestAnnouncementDate = $latestDate
    candidateCount = $deduped.Count
    source = $sourceUrl
    periodMonths = 3
  }
  $candidateJson = $deduped | ConvertTo-Json -Depth 4 -Compress
  $metaJson = $meta | ConvertTo-Json -Depth 3 -Compress
  $content = "window.PCC_SYNC_META = $metaJson;`nwindow.PCC_CANDIDATES = $candidateJson;`n"
  [System.IO.File]::WriteAllText($tempPath, $content, [System.Text.UTF8Encoding]::new($false))

  & node.exe --check $tempPath
  if ($LASTEXITCODE -ne 0) { throw "產生的候選資料檔未通過語法檢查。" }
  Move-Item -Force -Path $tempPath -Destination $targetPath
  Copy-Item -Force -Path $targetPath -Destination $publicTargetPath
  $assetVersion = [datetime]::Now.ToString("yyyyMMddHHmm", [Globalization.CultureInfo]::InvariantCulture)
  foreach ($htmlPath in @($indexPath, $publicIndexPath)) {
    if (-not (Test-Path $htmlPath)) { continue }
    $indexContent = [System.IO.File]::ReadAllText($htmlPath, [System.Text.Encoding]::UTF8)
    $indexContent = [regex]::Replace($indexContent, 'pcc-candidates\.js(?:\?v=[^"'']+)?', "pcc-candidates.js?v=$assetVersion")
    [System.IO.File]::WriteAllText($htmlPath, $indexContent, [System.Text.UTF8Encoding]::new($false))
  }
  Write-Log "更新成功：$($deduped.Count) 筆工程候選，最新公告日 $latestDate。"
} catch {
  if (Test-Path $tempPath) { Remove-Item -Force $tempPath }
  Write-Log "更新失敗：$($_.Exception.Message)；保留上一版資料。"
  exit 1
}
