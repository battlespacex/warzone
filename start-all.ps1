Write-Host "Starting BattlespaceX / StratOps services..." -ForegroundColor Cyan

$root = "C:\websites\warzone-worker\warzone"
$worker = "$root\apps\worker"

Set-Location $root

# Restore saved PM2 services
pm2 resurrect

# Restart persistent services with latest environment variables
pm2 restart warzone-api --update-env
pm2 restart warzone-worker --update-env
pm2 restart warzone-frontend --update-env
pm2 restart daalshaal --update-env

Write-Host ""
Write-Host "Persistent services restarted." -ForegroundColor Green
Write-Host "Copernicus runs continuously through warzone-worker." -ForegroundColor Cyan

# Run reporting pipeline once
Set-Location $worker

Write-Host ""
Write-Host "Generating reports..." -ForegroundColor Yellow
npm run reports:once

Write-Host "Capturing reports..." -ForegroundColor Yellow
npm run reports:capture

Write-Host "Rendering reports..." -ForegroundColor Yellow
npm run reports:render

Write-Host "Generating PDFs..." -ForegroundColor Yellow
npm run reports:pdf

# Return to project root
Set-Location $root

pm2 save
pm2 list

Write-Host ""
Write-Host "All StratOps services and reporting jobs completed." -ForegroundColor Green