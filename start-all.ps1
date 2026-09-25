Write-Host "Starting BattlespaceX / StratOps services..." -ForegroundColor Cyan

Set-Location "C:\websites\warzone-worker\warzone"

# Restore saved PM2 services
pm2 resurrect

# Restart persistent services
pm2 restart warzone-api
pm2 restart warzone-worker
pm2 restart warzone-frontend
pm2 restart daalshaal

# Run Copernicus once
Write-Host "Running Copernicus..." -ForegroundColor Yellow
Set-Location "C:\websites\warzone-worker\warzone\apps\worker"
npm run copernicus:once

# Run reporting pipeline
Write-Host "Generating reports..." -ForegroundColor Yellow
npm run reports:once

Write-Host "Capturing reports..." -ForegroundColor Yellow
npm run reports:capture

Write-Host "Rendering reports..." -ForegroundColor Yellow
npm run reports:render

Write-Host "Generating PDFs..." -ForegroundColor Yellow
npm run reports:pdf

# Return to project root
Set-Location "C:\websites\warzone-worker\warzone"

pm2 save
pm2 list

Write-Host "All services and one-time jobs completed." -ForegroundColor Green