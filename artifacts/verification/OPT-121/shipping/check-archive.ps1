param([string]$Revision = 'HEAD')
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../../../..')).Path
$archivePath = Join-Path $repoRoot '.tmp/opt121-source.zip'
$appTree = (& git -C $repoRoot rev-parse "${Revision}:payload-office-platform").Trim()
if ($LASTEXITCODE -ne 0 -or $appTree -notmatch '^[0-9a-f]{40}$') { throw '无效应用tree' }
& git -C $repoRoot archive --format=zip "--output=$archivePath" "${Revision}:payload-office-platform"
if ($LASTEXITCODE -ne 0) { throw '归档失败' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
  $names = @($archive.Entries | ForEach-Object FullName)
  $required = @('Dockerfile','package.json','pnpm-lock.yaml','patches/payload@3.86.0.patch','scripts/migrate-locked.ts','src/payload.config.ts','src/test/factory/roles.ts','src/assets/hero-poster.jpg','src/domain/supply/building-slug.ts','src/domain/supply/building-grade.ts','src/domain/mini-program/grade-schema.ts','src/migrations/index.ts','src/migrations/20261017_160929_opt_121_building_grade_options_expand.ts')
  foreach ($name in $required) { if ($names -notcontains $name) { throw "缺少运行时文件：$name" } }
  if (@($names | Where-Object { $_ -like 'content/*' }).Count -gt 0) { throw '归档不应包含导入素材' }
  $bytes = (Get-Item -LiteralPath $archivePath).Length
  if ($bytes + 512 -gt 3145728) { throw '含build-info余量后仍超过3MB' }
  $result = [ordered]@{ applicationTree = $appTree; sourceArchiveBytes = $bytes; thresholdBytes = 3145728; reservedBuildInfoBytes = 512; requiredFiles = $required; importedContentFiles = 0 }
  $json = $result | ConvertTo-Json -Depth 4
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'archive-check.json'), $json + "`n", (New-Object Text.UTF8Encoding($false)))
  Write-Output $json
} finally { $archive.Dispose() }
