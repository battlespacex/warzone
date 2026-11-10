# Integration checks run the real deployment orchestration with entirely mocked AWS/HTTP/Node commands.
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$fixture = Join-Path $repo ('.generated/deployment-review-20261109/fixture-' + [guid]::NewGuid().ToString('N'))
@('assets/js', 'assets/css', 'assets/cesium/releases/test', 'poster', 'pages') | ForEach-Object {
    New-Item -ItemType Directory -Path (Join-Path $fixture $_) -Force | Out-Null
}
$html = '<link href="/assets/css/main.12345678.css"><script src="/assets/js/main.12345678.js"></script>'
Set-Content (Join-Path $fixture 'poster/index.html') $html -NoNewline
Set-Content (Join-Path $fixture 'pages/poster.html') $html -NoNewline
Set-Content (Join-Path $fixture 'pages/index.html') $html -NoNewline
Set-Content (Join-Path $fixture 'assets/js/main.12345678.js') 'console.log(1);'
Set-Content (Join-Path $fixture 'assets/js/331.bundle.12345678.js') 'const poster = "pr-bg-1.jpg";'
Set-Content (Join-Path $fixture 'assets/css/main.12345678.css') '.poster-generator-page { color: white; }'
Set-Content (Join-Path $fixture 'cesium-assets.json') '{"variant":"standard","baseUrl":"/assets/cesium/releases/test"}'
$global:deployTestFixture = $fixture
$global:deployTestHtml = $html
$scriptPath = Join-Path $repo 'scripts/deploy-production.ps1'
$base = @{ SkipBuild = $true; BuildDirectory = $fixture.Substring($repo.Length + 1); Bucket = 'staging-bucket'; DistributionId = 'STAGING123'; Profile = 'staging-profile'; PublicBaseUrl = 'https://staging.example.test'; TargetEnvironment = 'staging' }

function global:aws {
    $arguments = @($args)
    $global:deployTestEvents.Add(@{ Kind = 'aws'; Arguments = $arguments })
    $global:LASTEXITCODE = 0
    if ($arguments -contains 'get-distribution') { return $global:deployTestDistribution | ConvertTo-Json -Depth 20 }
    if ($arguments -contains 'create-invalidation') { return 'INV123' }
    if ($global:deployTestFailure -eq 'upload' -and $arguments -contains "s3://staging-bucket/assets/css/") { $global:LASTEXITCODE = 1 }
}
function global:node {
    $arguments = @($args)
    $global:deployTestEvents.Add(@{ Kind = 'node'; Arguments = $arguments })
    $global:LASTEXITCODE = 0
    if ($arguments[0] -like '*frontend-assets.cjs' -and
        (($global:deployTestFailure -eq 'frontend-live' -and $arguments -contains '--verify-live') -or
         ($global:deployTestFailure -eq 'frontend-local' -and $arguments -contains '--verify'))) { $global:LASTEXITCODE = 1 }
    if ($global:deployTestFailure -eq 'cesium-live' -and $arguments[0] -like '*cesium-assets.cjs' -and $arguments -contains '--verify-live') { $global:LASTEXITCODE = 1 }
}
function global:Invoke-WebRequest {
    param($Uri, [switch]$UseBasicParsing, $TimeoutSec)
    $url = [uri]$Uri
    if ($url.AbsolutePath.EndsWith('.css')) { return @{ StatusCode = 200; Headers = @{ 'Content-Type' = 'text/css' }; Content = '.poster-generator-page {}' } }
    if ($url.AbsolutePath.EndsWith('.js')) { return @{ StatusCode = 200; Headers = @{ 'Content-Type' = 'application/javascript' }; Content = 'console.log(1);' } }
    return @{ StatusCode = 200; Headers = @{ 'Content-Type' = 'text/html' }; Content = $global:deployTestHtml }
}
function Reset-Fixture {
    $global:deployTestEvents = New-Object 'System.Collections.Generic.List[object]'
    $global:deployTestFailure = ''
    $global:deployTestDistribution = @{ Distribution = @{ Id = 'STAGING123'; DomainName = 'test.cloudfront.net'; DistributionConfig = @{
        Aliases = @{ Items = @('staging.example.test') }; DefaultCacheBehavior = @{ TargetOriginId = 'origin' }
        CacheBehaviors = @{ Items = @() }; Origins = @{ Items = @(@{ Id = 'origin'; DomainName = 'staging-bucket.s3.amazonaws.com'; OriginPath = ''; S3OriginConfig = @{ OriginAccessIdentity = '' } }) }
    } } }
}
function Assert-True($condition, $message) { if (-not $condition) { throw $message } }
function Html-Writes { @($global:deployTestEvents | Where-Object { $_.Kind -eq 'aws' -and $_.Arguments -contains '*.html' -and $_.Arguments -contains '--include' }) }
function Manifest-Writes { @($global:deployTestEvents | Where-Object { $_.Kind -eq 'aws' -and $_.Arguments -contains 's3://staging-bucket/cesium-assets.json' }) }
function Expect-Failure($parameters) {
    $failed = $false
    try { & $scriptPath @parameters } catch { $failed = $true; Write-Host "Expected refusal: $($_.Exception.Message)" }
    Assert-True $failed 'Expected deployment refusal'
    Assert-True ((Html-Writes).Count -eq 0) 'HTML must not be published on failure'
    Assert-True ((Manifest-Writes).Count -eq 0) 'Manifest must not be published on pre-publication failure'
}
$passed = 0
Reset-Fixture
& $scriptPath -ValidateOnly -BuildDirectory $base.BuildDirectory
Assert-True (@($global:deployTestEvents | Where-Object Kind -eq 'aws').Count -eq 0) 'ValidateOnly called AWS'
$passed++
Reset-Fixture
Expect-Failure (@{ ValidateOnly = $true; Execute = $true; BuildDirectory = $base.BuildDirectory })
$passed++
Reset-Fixture
& $scriptPath @base
Assert-True (@($global:deployTestEvents | Where-Object Kind -eq 'aws').Count -eq 1) 'Dry run invoked a mutation'
Assert-True ($global:deployTestEvents[-1].Arguments -contains 'get-distribution') 'Dry run should only query configuration'
$passed++
Reset-Fixture
& $scriptPath @base -Execute
$events = $global:deployTestEvents
$htmlWrites = @(Html-Writes)
Assert-True ($htmlWrites.Count -eq 1) 'Expected one HTML publication phase'
Assert-True ($htmlWrites[0].Arguments -contains 'assets/*') 'HTML sync must not overwrite immutable vendor HTML'
$includeIndex = [array]::IndexOf($htmlWrites[0].Arguments, '*.html')
Assert-True ($htmlWrites[0].Arguments[$includeIndex + 1] -eq '--exclude' -and $htmlWrites[0].Arguments[$includeIndex + 2] -eq 'assets/*') 'Asset exclusion must follow the HTML inclusion (S3 filter order)'
$htmlIndex = $events.IndexOf($htmlWrites[0])
$manifestWrites = @(Manifest-Writes)
Assert-True ($manifestWrites.Count -eq 1) 'Expected one manifest publication'
foreach ($helper in @('frontend-assets.cjs', 'cesium-assets.cjs')) {
    $gate = @($events | Where-Object { $_.Kind -eq 'node' -and $_.Arguments[0] -like "*$helper" -and $_.Arguments -contains '--verify-live' })
    Assert-True ($gate.Count -eq 1 -and $events.IndexOf($gate[0]) -lt $htmlIndex) "$helper must gate HTML"
    Assert-True ($events.IndexOf($gate[0]) -lt $events.IndexOf($manifestWrites[0])) "$helper must gate the manifest"
}
foreach ($event in @($events | Where-Object Kind -eq 'aws')) {
    Assert-True ($event.Arguments[0] -eq '--profile' -and $event.Arguments[1] -eq 'staging-profile') 'Wrong AWS profile'
    foreach ($argument in $event.Arguments) {
        if ($argument -like 's3://*') { Assert-True ($argument -like 's3://staging-bucket/*') 'Wrong S3 bucket' }
    }
    Assert-True (-not ($event.Arguments -contains '--delete')) 'Retained assets would be deleted'
}
Assert-True (@($events | Where-Object { $_.Kind -eq 'aws' -and $_.Arguments -contains 'cesium/*' }).Count -eq 1) 'Legacy Cesium should be excluded'
$passed++
foreach ($failure in @('upload', 'frontend-local', 'frontend-live', 'cesium-live')) {
    Reset-Fixture
    $global:deployTestFailure = $failure
    Expect-Failure ($base + @{ Execute = $true })
    $passed++
}
foreach ($badTarget in @('production-id', 'production-host', 'production-alias', 'alias', 'bucket', 'behavior', 'origin-path', 'missing-target', 'missing-profile')) {
    Reset-Fixture
    $parameters = $base.Clone(); $parameters.Execute = $true
    switch ($badTarget) {
        'production-id' { $parameters.DistributionId = 'E2EFV9935XX3MV' }
        'production-host' { $parameters.PublicBaseUrl = 'https://stratops.battlespacex.com' }
        'production-alias' { $global:deployTestDistribution.Distribution.DistributionConfig.Aliases.Items += 'stratops.battlespacex.com' }
        'alias' { $global:deployTestDistribution.Distribution.DistributionConfig.Aliases.Items = @('other.example.test') }
        'bucket' { $global:deployTestDistribution.Distribution.DistributionConfig.Origins.Items[0].DomainName = 'production-bucket.s3.amazonaws.com' }
        'behavior' { $global:deployTestDistribution.Distribution.DistributionConfig.CacheBehaviors.Items = @(@{ PathPattern = '/assets/js/*'; TargetOriginId = 'unreviewed-origin' }) }
        'origin-path' { $global:deployTestDistribution.Distribution.DistributionConfig.Origins.Items[0].OriginPath = '/unexpected' }
        'missing-target' { $parameters.Remove('TargetEnvironment') }
        'missing-profile' { $parameters.Remove('Profile') }
    }
    Expect-Failure $parameters
    Assert-True (@($global:deployTestEvents | Where-Object { $_.Kind -eq 'aws' -and -not ($_.Arguments -contains 'get-distribution') }).Count -eq 0) 'Target validation must precede all writes'
    $passed++
}
Write-Host "PASS: $passed deployment safety scenarios (mocked AWS; no network requests)."
