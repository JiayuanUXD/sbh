param([Parameter(Mandatory=$true)][string]$SourcePath, [Parameter(Mandatory=$true)][string]$OutputZip)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = (Resolve-Path -LiteralPath $SourcePath).Path
if (Test-Path -LiteralPath $OutputZip) { throw 'Output archive already exists' }
$zip = [System.IO.Compression.ZipFile]::Open($OutputZip, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  Get-ChildItem -LiteralPath $root -Recurse -File -Force | ForEach-Object {
    $name = $_.FullName.Substring($root.Length + 1).Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, $name,
      [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
  }
} finally { $zip.Dispose() }
$check = [System.IO.Compression.ZipFile]::OpenRead($OutputZip)
try {
  if (@($check.Entries | Where-Object { $_.FullName.Contains('\') }).Count) { throw 'Non-POSIX ZIP path' }
  [pscustomobject]@{ entries = $check.Entries.Count; posix = $true;
    bytes = (Get-Item -LiteralPath $OutputZip).Length } | ConvertTo-Json -Compress
} finally { $check.Dispose() }
