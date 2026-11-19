param(
    [int]$Port = 9222,
    [string]$ProfileDir = "$env:LOCALAPPDATA\ChromeDebugProfile",
    [string]$StartUrl = "about:blank"
)

$candidates = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

$chromePath = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chromePath) {
    Write-Error "Chrome executable not found in standard paths. Please launch Chrome manually with --remote-debugging-port=$Port --user-data-dir=`"$ProfileDir`""
    exit 1
}

if (-not (Test-Path $ProfileDir)) {
    New-Item -ItemType Directory -Path $ProfileDir -Force | Out-Null
}

Write-Host "Launching Chrome with CDP on port $Port..."
Write-Host "Profile directory: $ProfileDir"

Start-Process -FilePath $chromePath -ArgumentList @(
    "--remote-debugging-port=$Port",
    "--user-data-dir=$ProfileDir",
    "--no-first-run",
    "--no-default-browser-check",
    $StartUrl
)

Write-Host "Done. Verify at http://127.0.0.1:$Port/json/version"
