param(
  [Parameter(Mandatory=$true)][string]$Ffmpeg,
  [string]$Output = 'E:/wt-pub/payload-office-platform/src/assets/hero-poster.jpg'
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $Ffmpeg -PathType Leaf)) { throw 'FFmpeg executable not found' }
Write-Verbose "FFmpeg: $Ffmpeg; output: $Output"
# Extract the original frame; retain its composition and video watermark.
$process = Start-Process -FilePath $Ffmpeg -WindowStyle Hidden -Wait -PassThru -ArgumentList @(
  '-hide_banner', '-ss', '0.5', '-i', 'https://shangban.cc/api/media/file/sbh-hero-10s.mp4?prefix=media',
  '-frames:v', '1', '-q:v', '2', '-update', '1', '-y', ('"' + $Output + '"')
) -RedirectStandardError ($Output + '.ffmpeg.log')
if ($process.ExitCode -ne 0) { throw 'Video frame extraction failed; inspect .ffmpeg.log' }
Get-FileHash -LiteralPath $Output -Algorithm SHA256 | Select-Object Hash
