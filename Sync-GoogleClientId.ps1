$ErrorActionPreference = 'Stop'

$wranglerPath = Join-Path $PSScriptRoot 'cloudflare\wrangler.toml'
$jsonPath = Join-Path $PSScriptRoot 'ErAudio.json'

$inVars = $false
$settings = @(
    foreach ($line in Get-Content -LiteralPath $wranglerPath) {
        if ($line -match '^\s*\[') {
            $inVars = $line -cmatch '^\s*\[\s*vars\s*\]\s*(?:#.*)?$'
        } elseif ($inVars -and $line -cmatch '^\s*GOOGLE_CLIENT_ID\s*=') {
            $line
        }
    }
)

$pattern = '^\s*GOOGLE_CLIENT_ID\s*=\s*(?<quote>["''])(?<id>[A-Za-z0-9_-]+\.apps\.googleusercontent\.com)\k<quote>\s*(?:#.*)?$'
if ($settings.Count -ne 1 -or $settings[0] -cnotmatch $pattern) {
    throw 'Set exactly one GOOGLE_CLIENT_ID under [vars] in cloudflare\wrangler.toml to a quoted Google web client ID ending in .apps.googleusercontent.com.'
}
$clientId = $Matches.id

$config = ConvertFrom-Json -InputObject ([IO.File]::ReadAllText($jsonPath))
if ($config.historySync -isnot [pscustomobject]) {
    throw 'ErAudio.json must contain a historySync object.'
}
if ($config.historySync.googleClientId -ceq $clientId) {
    Write-Output 'ErAudio.json already has the configured Google client ID.'
    return
}

$config.historySync | Add-Member -NotePropertyName googleClientId -NotePropertyValue $clientId -Force
$json = ConvertTo-Json -InputObject $config -Depth 100
[IO.File]::WriteAllText($jsonPath, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Output 'Updated historySync.googleClientId in ErAudio.json.'
