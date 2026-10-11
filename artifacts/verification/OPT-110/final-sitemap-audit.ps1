param([string]$directory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'
$source = Get-Content "$directory/published-source-urls.json" -Raw -Encoding utf8 | ConvertFrom-Json
$index = [xml](Invoke-WebRequest -UseBasicParsing -Uri 'https://shangban.cc/sitemap.xml' -TimeoutSec 60).Content
$results = @{}
foreach ($kind in @('buildings', 'listings')) {
    $urls = [System.Collections.Generic.HashSet[string]]::new()
    $total = 0
    $shards = @()
    foreach ($location in @($index.sitemapindex.sitemap.loc | Where-Object { $_ -like "*/shanghai/$kind/*" })) {
        $xml = $null
        for ($attempt = 1; $attempt -le 3; $attempt++) {
            try {
                $xml = [xml](Invoke-WebRequest -UseBasicParsing -Uri $location -TimeoutSec 60).Content
                break
            } catch {
                if ($attempt -eq 3) { throw }
                Start-Sleep -Seconds 2
            }
        }
        $entries = @($xml.urlset.url)
        foreach ($entry in $entries) { [void]$urls.Add([string]$entry.loc) }
        $total += $entries.Count
        $shards += [pscustomobject]@{ url = $location; count = $entries.Count }
        Write-Output "$kind $($shards.Count): $($entries.Count)"
    }
    $missing = @($source.$kind | Where-Object { -not $urls.Contains([string]$_) })
    $results[$kind] = [pscustomobject]@{ total = $total; unique = $urls.Count; sourceCount = $source.$kind.Count; missingSource = $missing.Count; missingExamples = @($missing | Select-Object -First 10); shards = $shards }
    if ($total -ne $urls.Count -or $missing.Count -gt 0) { throw "$kind sitemap contains duplicate URLs or missing source URLs" }
}
$result = [pscustomobject]@{ at = [DateTime]::UtcNow.ToString('o'); buildings = $results.buildings; listings = $results.listings }
$result | ConvertTo-Json -Depth 6 | Set-Content "$directory/final-sitemap-audit.json" -Encoding utf8
$result | Select-Object at, @{Name='buildings';Expression={$_.buildings.total}}, @{Name='listings';Expression={$_.listings.total}} | ConvertTo-Json -Compress
