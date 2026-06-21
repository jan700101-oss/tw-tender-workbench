$ErrorActionPreference = "Stop"

$version = [datetime]::Now.ToString("yyyyMMddHHmmss", [Globalization.CultureInfo]::InvariantCulture)
$url = "https://jan700101-oss.github.io/tw-tender-workbench/?open=$version"

Start-Process -FilePath "$env:WINDIR\System32\rundll32.exe" `
  -ArgumentList @("url.dll,FileProtocolHandler", "`"$url`"") `
  -WindowStyle Hidden
