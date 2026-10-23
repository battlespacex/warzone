param(
    [Parameter(Mandatory = $true)][string]$Bucket,
    [Parameter(Mandatory = $true)][string]$DistributionId,
    [string]$Profile,
    [string]$PublicBaseUrl = 'https://stratops.battlespacex.com',
    [switch]$SkipBuild,
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$production = Join-Path $root 'production'
$posterOutputs = @(
    (Join-Path $production 'poster\index.html'),
    (Join-Path $production 'pages\poster.html')
)
$profileArgs = if ($Profile) { @('--profile', $Profile) } else { @() }
$dryRunArgs = if ($Execute) { @() } else { @('--dryrun') }
$immutableCache = 'public, max-age=31536000, immutable'
$shortCache = 'public, max-age=300'
$htmlCache = 'no-cache, no-store, must-revalidate'

function Invoke-Aws {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    & aws @profileArgs @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "AWS CLI failed: aws $($Arguments -join ' ')"
    }
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
            $relativePath = [IO.Path]::GetRelativePath($production, $_.FullName).Replace('\', '/')
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

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'AWS CLI is required for frontend deployment.'
}

if (-not $SkipBuild) {
    & npm run build
    if ($LASTEXITCODE -ne 0) {
        throw 'Production build failed.'
    }
}

Assert-PosterBuild

# Upload content-addressed CSS and JavaScript before publishing HTML that references it.
Invoke-Aws -Arguments (@(
    's3', 'sync', (Join-Path $production 'assets\css'), "s3://$Bucket/assets/css/",
    '--cache-control', $immutableCache, '--only-show-errors'
) + $dryRunArgs)
Invoke-Aws -Arguments (@(
    's3', 'sync', (Join-Path $production 'assets\js'), "s3://$Bucket/assets/js/",
    '--cache-control', $immutableCache, '--only-show-errors'
) + $dryRunArgs)

# Non-hashed assets use a short cache so updates remain recoverable without renaming files.
Invoke-Aws -Arguments (@(
    's3', 'sync', (Join-Path $production 'assets'), "s3://$Bucket/assets/",
    '--exclude', 'css/*', '--exclude', 'js/*',
    '--cache-control', $shortCache, '--only-show-errors'
) + $dryRunArgs)
Invoke-Aws -Arguments (@(
    's3', 'sync', $production, "s3://$Bucket/",
    '--exclude', 'assets/*', '--exclude', '*.html',
    '--cache-control', $shortCache, '--only-show-errors'
) + $dryRunArgs)

# Publish HTML last. Do not use --delete: old hashed assets must survive cached HTML.
Invoke-Aws -Arguments (@(
    's3', 'sync', $production, "s3://$Bucket/",
    '--exclude', '*', '--include', '*.html',
    '--content-type', 'text/html; charset=utf-8',
    '--cache-control', $htmlCache, '--only-show-errors'
) + $dryRunArgs)

if (-not $Execute) {
    Write-Host 'Dry run complete. Add -Execute after reviewing the planned uploads.'
    exit 0
}

$assetPaths = @(
    @(Get-PosterAssetReferences -HtmlPath $posterOutputs[0]) +
    @(Get-AsyncJavaScriptReferences)
) | Sort-Object -Unique
$invalidationPaths = @('/poster', '/poster/', '/poster/index.html', '/pages/poster.html') + $assetPaths
$invalidationId = & aws @profileArgs cloudfront create-invalidation `
    --distribution-id $DistributionId `
    --paths @invalidationPaths `
    --query 'Invalidation.Id' `
    --output text
if ($LASTEXITCODE -ne 0 -or -not $invalidationId) {
    throw 'CloudFront invalidation creation failed.'
}

Invoke-Aws -Arguments @(
    'cloudfront', 'wait', 'invalidation-completed',
    '--distribution-id', $DistributionId,
    '--id', $invalidationId.Trim()
)

Assert-LivePoster
Write-Host 'Production frontend deployment and live Poster Generator verification completed successfully.'
