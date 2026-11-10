param(
    [string]$Bucket,
    [string]$DistributionId,
    [string]$Profile,
    [string]$PublicBaseUrl,
    [ValidateSet('staging', 'production')][string]$TargetEnvironment,
    [string]$BuildDirectory = 'production',
    [switch]$SkipBuild,
    [switch]$ValidateOnly,
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
if ($ValidateOnly -and $Execute) { throw '-ValidateOnly and -Execute cannot be combined.' }
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$production = [IO.Path]::GetFullPath((Join-Path $root $BuildDirectory))
$posterOutputs = @(
    (Join-Path $production 'poster\index.html'),
    (Join-Path $production 'pages\poster.html')
)
$profileArgs = if ($Profile) { @('--profile', $Profile) } else { @() }
$immutableCache = 'public, max-age=31536000, immutable'
$shortCache = 'public, max-age=300'
$htmlCache = 'no-cache, no-store, must-revalidate'

function Invoke-Aws {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    if ($ValidateOnly) { throw 'AWS calls are forbidden in ValidateOnly mode.' }
    $operation = $Arguments[0] + ' ' + $Arguments[1]
    if ($operation -in @('s3 sync', 's3 cp', 'cloudfront create-invalidation')) {
        if (-not $Execute) {
            Write-Host "Planned (requires -Execute): aws $($profileArgs -join ' ') $($Arguments -join ' ')"
            return
        }
        if ($Arguments -contains '--delete') { throw 'Deleting retained release assets is forbidden.' }
    } elseif ($operation -notin @('cloudfront get-distribution', 'cloudfront wait')) {
        throw "Unreviewed AWS operation: $operation"
    }
    & aws @profileArgs @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "AWS CLI failed: aws $($Arguments -join ' ')"
    }
}

function Assert-DeploymentTarget {
    if (-not $TargetEnvironment -or -not $Profile -or -not $PublicBaseUrl -or
        $Bucket -notmatch '^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$' -or $DistributionId -notmatch '^[A-Z0-9]+$') {
        throw 'Specify an explicit TargetEnvironment, Profile, PublicBaseUrl, Bucket and DistributionId (also for dry runs).'
    }
    $site = [uri]$PublicBaseUrl
    if (-not $site.IsAbsoluteUri -or $site.Scheme -ne 'https' -or $site.Port -ne 443 -or
        $site.AbsolutePath -ne '/' -or $site.UserInfo -or $site.Query -or $site.Fragment) {
        throw 'PublicBaseUrl must be an HTTPS site origin.'
    }
    if ($TargetEnvironment -eq 'staging' -and
        ($site.Host -eq 'stratops.battlespacex.com' -or $DistributionId -eq 'E2EFV9935XX3MV')) {
        throw 'Staging cannot target the known production hostname or distribution.'
    }
    $result = (Invoke-Aws -Arguments @('cloudfront', 'get-distribution', '--id', $DistributionId, '--output', 'json')) | ConvertFrom-Json
    $distribution = $result.Distribution
    $config = $distribution.DistributionConfig
    if ($distribution.Id -ne $DistributionId -or $site.Host -notin (@($config.Aliases.Items) + @($distribution.DomainName))) {
        throw 'PublicBaseUrl does not belong to the selected distribution.'
    }
    if ($TargetEnvironment -eq 'staging' -and 'stratops.battlespacex.com' -in @($config.Aliases.Items)) {
        throw 'Staging cannot use a distribution with the production alias.'
    }
    # Resolve ordered cache behaviors for every uploaded file, not just the default origin.
    $paths = @(Get-ChildItem -LiteralPath $production -File -Recurse | ForEach-Object {
        $_.FullName.Substring($production.Length + 1).Replace('\', '/')
    }) + @('', 'poster', 'poster/')
    foreach ($path in $paths) {
        $behavior = $config.DefaultCacheBehavior
        foreach ($candidate in @($config.CacheBehaviors.Items)) {
            if (-not $candidate) { continue }
            $pattern = '^' + [regex]::Escape($candidate.PathPattern.TrimStart('/')).Replace('\*', '.*').Replace('\?', '.') + '$'
            if ($path -cmatch $pattern) { $behavior = $candidate; break }
        }
        $origin = @($config.Origins.Items | Where-Object { $_.Id -eq $behavior.TargetOriginId })
        $bucketPattern = '^' + [regex]::Escape($Bucket) + '\.s3(?:[.-][a-z0-9-]+)*\.amazonaws\.com(?:\.cn)?$'
        if ($origin.Count -ne 1 -or -not $origin[0].S3OriginConfig -or $origin[0].DomainName -notmatch $bucketPattern -or $origin[0].OriginPath) {
            throw "Selected bucket is not the direct S3 origin for /$path (origin paths/groups/custom origins require separate review)."
        }
    }
    Write-Host "Validated $TargetEnvironment target: $Bucket / $DistributionId / $($site.Host), profile $Profile"
}

function Get-PosterAssetReferences {
    param([Parameter(Mandatory = $true)][string]$HtmlPath)

    $html = Get-Content -LiteralPath $HtmlPath -Raw
    return [regex]::Matches(
        $html,
        '(?i)(?:src|href)=["''](/assets/(?:css|js)/[^"'']+)["'']'
    ) | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
}

function Get-AsyncJavaScriptReferences {
    $javascriptRoot = Join-Path $production 'assets\js'
    if (-not (Test-Path -LiteralPath $javascriptRoot -PathType Container)) {
        throw "Missing generated JavaScript directory: $javascriptRoot"
    }

    return Get-ChildItem -LiteralPath $javascriptRoot -Recurse -File -Filter '*.js' |
        Where-Object { $_.Name -match '^\d+\.bundle\.[0-9a-f]{8}\.js$' } |
        ForEach-Object {
            $relativePath = 'assets/js/' + $_.FullName.Substring($javascriptRoot.Length + 1).Replace('\', '/')
            "/$relativePath"
        } |
        Sort-Object -Unique
}

function Get-PosterGeneratorChunkReference {
    $matches = @(Get-AsyncJavaScriptReferences | Where-Object {
        $relativePath = $_.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
        $chunkPath = Join-Path $production $relativePath
        (Get-Content -LiteralPath $chunkPath -Raw) -match 'pr-bg-1\.jpg'
    })

    if ($matches.Count -ne 1) {
        throw "Expected exactly one asynchronous Poster Generator chunk, found $($matches.Count)."
    }

    return $matches[0]
}

function Assert-LiveJavaScriptAsset {
    param([Parameter(Mandatory = $true)][string]$Reference)

    $response = Invoke-WebRequest -Uri ($PublicBaseUrl.TrimEnd('/') + $Reference) -UseBasicParsing -TimeoutSec 30
    if ([int]$response.StatusCode -ne 200) {
        throw "Live JavaScript asset returned $($response.StatusCode): $Reference"
    }
    if ($response.Headers['Content-Type'] -notmatch '^(application|text)/(?:x-)?javascript') {
        throw "Live JavaScript asset returned an unexpected content type: $Reference ($($response.Headers['Content-Type']))"
    }
    if ($response.Content.TrimStart().StartsWith('<')) {
        throw "Live JavaScript asset returned HTML instead of JavaScript: $Reference"
    }
}

function Assert-PosterBuild {
    foreach ($posterOutput in $posterOutputs) {
        if (-not (Test-Path -LiteralPath $posterOutput -PathType Leaf)) {
            throw "Missing generated poster HTML: $posterOutput"
        }

        $references = @(Get-PosterAssetReferences -HtmlPath $posterOutput)
        if ($references.Count -lt 2) {
            throw "Generated poster HTML does not reference both CSS and JavaScript: $posterOutput"
        }

        foreach ($reference in $references) {
            $relativePath = $reference.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
            $assetPath = Join-Path $production $relativePath
            if (-not (Test-Path -LiteralPath $assetPath -PathType Leaf)) {
                throw "Generated poster asset is missing: $reference ($assetPath)"
            }
        }
    }

    $primary = Get-Content -LiteralPath $posterOutputs[0] -Raw
    $compatibility = Get-Content -LiteralPath $posterOutputs[1] -Raw
    if ($primary -cne $compatibility) {
        throw 'poster/index.html and pages/poster.html do not contain the same generated document.'
    }

    $asyncReferences = @(Get-AsyncJavaScriptReferences)
    if ($asyncReferences.Count -eq 0) {
        throw 'The production build did not emit any asynchronous JavaScript chunks.'
    }

    $posterChunkReference = Get-PosterGeneratorChunkReference
    Write-Host "Validated asynchronous Poster Generator chunk: $posterChunkReference"
}

function Assert-LivePoster {
    $expectedHtml = Get-Content -LiteralPath $posterOutputs[0] -Raw
    $expectedReferences = @(Get-PosterAssetReferences -HtmlPath $posterOutputs[0])
    $routes = @('/poster', '/poster/', '/poster/index.html', '/pages/poster.html')

    foreach ($route in $routes) {
        $response = Invoke-WebRequest -Uri ($PublicBaseUrl.TrimEnd('/') + $route) -UseBasicParsing -TimeoutSec 30
        if ([int]$response.StatusCode -ne 200) {
            throw "Live poster route returned $($response.StatusCode): $route"
        }
        if ($response.Headers['Content-Type'] -notmatch '^text/html') {
            throw "Live poster route returned an unexpected content type: $route ($($response.Headers['Content-Type']))"
        }
        if ($response.Content -cne $expectedHtml) {
            throw "Live poster route does not match the generated production HTML: $route"
        }
    }

    foreach ($reference in $expectedReferences) {
        $response = Invoke-WebRequest -Uri ($PublicBaseUrl.TrimEnd('/') + $reference) -UseBasicParsing -TimeoutSec 30
        if ([int]$response.StatusCode -ne 200) {
            throw "Live poster asset returned $($response.StatusCode): $reference"
        }

        $expectedContentType = if ($reference.EndsWith('.css')) { '^text/css' } else { '^(application|text)/(?:x-)?javascript' }
        if ($response.Headers['Content-Type'] -notmatch $expectedContentType) {
            throw "Live poster asset returned an unexpected content type: $reference ($($response.Headers['Content-Type']))"
        }
        if ($response.Content.TrimStart().StartsWith('<')) {
            throw "Live poster asset returned HTML instead of the expected asset: $reference"
        }
        if ($reference.EndsWith('.css') -and $response.Content -notmatch '\.poster-generator-page') {
            throw "Live stylesheet does not contain the Poster Generator styles: $reference"
        }
    }


    $asyncReferences = @(Get-AsyncJavaScriptReferences)
    $posterChunkReference = Get-PosterGeneratorChunkReference
    foreach ($reference in $asyncReferences) {
        Assert-LiveJavaScriptAsset -Reference $reference
    }
    Write-Host "Verified $($asyncReferences.Count) live asynchronous JavaScript chunks, including $posterChunkReference."
}

if (-not $SkipBuild -and -not $ValidateOnly) {
    if ($BuildDirectory -ne 'production') { throw 'Use -SkipBuild with a prebuilt custom BuildDirectory.' }
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw 'Production build failed.'
    }
}

Assert-PosterBuild
& node (Join-Path $PSScriptRoot 'frontend-assets.cjs') --verify $production
if ($LASTEXITCODE -ne 0) { throw 'Application asset build integrity verification failed.' }
& node (Join-Path $PSScriptRoot 'cesium-assets.cjs') --verify $production
if ($LASTEXITCODE -ne 0) { throw 'Cesium build integrity verification failed.' }
$cesiumManifest = Get-Content -LiteralPath (Join-Path $production 'cesium-assets.json') -Raw | ConvertFrom-Json
if ($cesiumManifest.variant -ne 'standard') {
    throw 'Compact Cesium is experimental. The normal deployment script accepts only standard releases.'
}
if ($ValidateOnly) { Write-Host 'Validated frontend and complete Cesium release; no build or AWS requests made.'; return }
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'AWS CLI is required for frontend deployment.'
}
Assert-DeploymentTarget

# A release directory is immutable. Keep previous releases for existing sessions and rollback.
$cesiumReleasePath = Join-Path $production $cesiumManifest.baseUrl.TrimStart('/')
Invoke-Aws -Arguments (@(
    's3', 'sync', $cesiumReleasePath, "s3://$Bucket$($cesiumManifest.baseUrl)/",
    '--cache-control', $immutableCache, '--only-show-errors'
))
if ($Execute) {
    # Fail before publishing HTML if even one vendor asset is unavailable or has wrong bytes/headers.
    & node (Join-Path $PSScriptRoot 'cesium-assets.cjs') --verify-live $production $PublicBaseUrl
    if ($LASTEXITCODE -ne 0) { throw 'Live Cesium release verification failed; new HTML has not been published.' }
}

# Upload content-addressed CSS and JavaScript before publishing HTML that references it.
Invoke-Aws -Arguments (@(
    's3', 'sync', (Join-Path $production 'assets\css'), "s3://$Bucket/assets/css/",
    '--cache-control', $immutableCache, '--only-show-errors'
))
Invoke-Aws -Arguments (@(
    's3', 'sync', (Join-Path $production 'assets\js'), "s3://$Bucket/assets/js/",
    '--cache-control', $immutableCache, '--only-show-errors'
))

# Non-hashed assets use a short cache so updates remain recoverable without renaming files.
Invoke-Aws -Arguments (@(
    's3', 'sync', (Join-Path $production 'assets'), "s3://$Bucket/assets/",
    '--exclude', 'css/*', '--exclude', 'js/*', '--exclude', 'cesium/*',
    '--cache-control', $shortCache, '--only-show-errors'
))
Invoke-Aws -Arguments (@(
    's3', 'sync', $production, "s3://$Bucket/",
    '--exclude', 'assets/*', '--exclude', '*.html', '--exclude', 'cesium-assets.json',
    '--cache-control', $shortCache, '--only-show-errors'
))

if ($Execute) {
    & node (Join-Path $PSScriptRoot 'frontend-assets.cjs') --verify-live $production $PublicBaseUrl
    if ($LASTEXITCODE -ne 0) { throw 'Live application asset verification failed; new HTML has not been published.' }
}

# Publish HTML last. Do not use --delete: old hashed assets must survive cached HTML.
Invoke-Aws -Arguments (@(
    's3', 'cp', (Join-Path $production 'cesium-assets.json'), "s3://$Bucket/cesium-assets.json",
    '--content-type', 'application/json', '--cache-control', $htmlCache, '--only-show-errors'
))
Invoke-Aws -Arguments (@(
    's3', 'sync', $production, "s3://$Bucket/",
    '--exclude', '*', '--include', '*.html', '--exclude', 'assets/*',
    '--content-type', 'text/html; charset=utf-8',
    '--cache-control', $htmlCache, '--only-show-errors'
))

if (-not $Execute) {
    Write-Host 'Dry run complete. Add -Execute after reviewing the planned uploads.'
    return
}

$assetPaths = @(
    @(Get-PosterAssetReferences -HtmlPath $posterOutputs[0]) +
    @(Get-AsyncJavaScriptReferences)
) | Sort-Object -Unique
$invalidationPaths = @('/', '/pages/index.html', '/cesium-assets.json', '/poster', '/poster/', '/poster/index.html', '/pages/poster.html') + $assetPaths
$invalidationId = Invoke-Aws -Arguments (@(
    'cloudfront', 'create-invalidation', '--distribution-id', $DistributionId, '--paths'
) + $invalidationPaths + @('--query', 'Invalidation.Id', '--output', 'text'))
if (-not $invalidationId) {
    throw 'CloudFront invalidation creation failed.'
}

Invoke-Aws -Arguments @(
    'cloudfront', 'wait', 'invalidation-completed',
    '--distribution-id', $DistributionId,
    '--id', $invalidationId.Trim()
)

Assert-LivePoster
Write-Host 'Production frontend deployment and live Poster Generator verification completed successfully.'
