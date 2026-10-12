param([string]$ExpectedVersion)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$http = [System.Net.Http.HttpClient]::new()
$http.Timeout = [TimeSpan]::FromSeconds(60)
$source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'published-source-urls.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$audit = [System.Collections.Generic.List[object]]::new()
$entities = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
function Read-Locations([string]$xml) {
  $settings = [System.Xml.XmlReaderSettings]::new()
  $settings.DtdProcessing = [System.Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $reader = [System.Xml.XmlReader]::Create([System.IO.StringReader]::new($xml), $settings)
  try {
    $doc = [System.Xml.XmlDocument]::new()
    $doc.XmlResolver = $null
    $doc.Load($reader)
    if ($doc.DocumentElement.NamespaceURI -ne 'http://www.sitemaps.org/schemas/sitemap/0.9') { throw 'Invalid sitemap namespace' }
    @($doc.GetElementsByTagName('loc') | ForEach-Object { $_.InnerText })
  } finally { $reader.Dispose() }
}
try {
  $health = $http.GetStringAsync('https://shangban.cc/api/health').GetAwaiter().GetResult() | ConvertFrom-Json
  if ($health.status -ne 'ok' -or ($ExpectedVersion -and $health.version -ne $ExpectedVersion)) { throw 'Build identity mismatch' }
  $index = $http.GetStringAsync('https://shangban.cc/sitemap.xml').GetAwaiter().GetResult()
  $shards = @(Read-Locations $index)
  if ($shards.Count -eq 0 -or @($shards | Select-Object -Unique).Count -ne $shards.Count) { throw 'Empty or duplicate shard index' }
  for ($offset = 0; $offset -lt $shards.Count; $offset += 4) {
    $batch = @($shards | Select-Object -Skip $offset -First 4 | ForEach-Object {
      $uri = [Uri]$_
      if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'shangban.cc' -or -not $uri.AbsolutePath.StartsWith('/sitemaps/')) { throw 'Unexpected shard URL' }
      [pscustomobject]@{ url = $_; task = $http.GetStringAsync($_); clock = [Diagnostics.Stopwatch]::StartNew() }
    })
    foreach ($item in $batch) {
      $xml = $item.task.GetAwaiter().GetResult()
      $locations = @(Read-Locations $xml)
      if ($locations.Count -gt 500) { throw 'Sitemap shard exceeds 500 URL capacity boundary' }
      foreach ($location in $locations) {
        if (-not $entities.Add($location)) { throw "Duplicate sitemap URL: $location" }
      }
      $entry = [pscustomobject]@{ url = $item.url; count = $locations.Count; elapsedMs = $item.clock.ElapsedMilliseconds }
      $audit.Add($entry)
      $entry | ConvertTo-Json -Compress
    }
  }
  $missingBuildings = @($source.buildings | Where-Object { -not $entities.Contains($_) })
  $missingListings = @($source.listings | Where-Object { -not $entities.Contains($_) })
  $report = [pscustomobject]@{ at = [DateTime]::UtcNow.ToString('o'); version = $health.version;
    shards = $audit; totalUniqueUrls = $entities.Count; expectedBuildings = $source.buildings.Count;
    expectedListings = $source.listings.Count; missingBuildings = $missingBuildings.Count; missingListings = $missingListings.Count }
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $PSScriptRoot 'production-full-sitemap-audit.json') -Encoding UTF8
  if ($missingBuildings.Count -or $missingListings.Count) { throw "Missing source URLs: buildings=$($missingBuildings.Count), listings=$($missingListings.Count)" }
  [pscustomobject]@{ success = $true; totalUniqueUrls = $entities.Count; sourceBuildings = $source.buildings.Count; sourceListings = $source.listings.Count } | ConvertTo-Json -Compress
} finally { $http.Dispose() }
