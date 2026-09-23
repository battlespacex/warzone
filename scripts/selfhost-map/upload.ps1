param(
    [Parameter(Mandatory = $true)][string]$Bucket,
    [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$output = Join-Path $root '.generated\selfhosted\output'
$map = Join-Path $output 'map\v1'
$terrain = Join-Path $output 'terrain\v1'
foreach ($required in @((Join-Path $map 'manifest.json'), (Join-Path $terrain 'layer.json'))) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
        throw "Missing pilot output: $required. Run pilot.py build-map and build-terrain first."
    }
}
if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    throw 'AWS CLI is required to upload static tiles.'
}

$dryRun = if ($Execute) { @() } else { @('--dryrun') }
$immutable = 'public, max-age=31536000, immutable'
$metadata = 'public, max-age=300'

aws s3 sync $map "s3://$Bucket/map/v1/" --exclude manifest.json --content-type image/jpeg --cache-control $immutable @dryRun
if ($LASTEXITCODE -ne 0) { throw 'Map tile upload failed.' }
aws s3 sync $terrain "s3://$Bucket/terrain/v1/" --exclude layer.json --content-type application/octet-stream --cache-control $immutable @dryRun
if ($LASTEXITCODE -ne 0) { throw 'Terrain tile upload failed.' }
aws s3 cp (Join-Path $map 'manifest.json') "s3://$Bucket/map/v1/manifest.json" --content-type application/json --cache-control $metadata @dryRun
if ($LASTEXITCODE -ne 0) { throw 'Map manifest upload failed.' }
aws s3 cp (Join-Path $terrain 'layer.json') "s3://$Bucket/terrain/v1/layer.json" --content-type application/json --cache-control $metadata @dryRun
if ($LASTEXITCODE -ne 0) { throw 'Terrain manifest upload failed.' }

if (-not $Execute) { Write-Host 'Dry run only. Add -Execute after reviewing the output.' }
