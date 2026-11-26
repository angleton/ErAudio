[CmdletBinding()]
param(
  [Alias('v')]
  [switch]$Visualizer,

  [Parameter(Position = 0)]
  [string]$Url,

  [ValidateRange(4, 32)]
  [int]$BandCount = 16,

  [ValidateRange(5, 30)]
  [int]$FramesPerSecond = 15,

  [switch]$Demo,

  [ValidateRange(0, 600)]
  [int]$DurationSeconds = 0
)

$ErrorActionPreference = 'Stop'

if (-not $Visualizer -and -not $Demo) {
  throw 'Use -v to start the audio visualizer, or -Demo to show a synthetic tone sweep.'
}
if ($Demo -and $Url) {
  throw 'The demo uses generated audio and cannot be combined with a YouTube URL.'
}
if ($Url) {
  $parsedUrl = $null
  if ((-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$parsedUrl)) -or
    $parsedUrl.Scheme -ne 'https' -or
    @('youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be') -notcontains $parsedUrl.Host) {
    throw 'Provide an HTTPS URL from youtube.com or youtu.be.'
  }
  Start-Process -FilePath $parsedUrl.AbsoluteUri
}

$visualizerPath = Join-Path $PSScriptRoot 'visualizer.ps1'
$visualizerParameters = @{
  BandCount = $BandCount
  FramesPerSecond = $FramesPerSecond
  DurationSeconds = $DurationSeconds
}
if ($Demo) {
  $visualizerParameters.Demo = $true
}
& $visualizerPath @visualizerParameters
