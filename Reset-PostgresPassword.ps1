<#  Reset-PostgresPassword.ps1
    - Temporarily enables local trust auth
    - Sets new password for user 'postgres'
    - Restores original pg_hba.conf
    Usage (Admin PS):
      .\Reset-PostgresPassword.ps1 -NewPassword 'YourStrongPass!123'
#>

param(
  [Parameter(Mandatory=$true)]
  [string]$NewPassword,
  [string]$PgVersion = "17",
  [string]$ServiceName = "postgresql-x64-17",
  [string]$Bin = "C:\Program Files\PostgreSQL\17\bin",
  [string]$DataDir = "C:\Program Files\PostgreSQL\17\data"
)

$ErrorActionPreference = "Stop"

function Tail-LastLog {
  param([string]$DataDir)
  $log = Get-ChildItem "$DataDir\log*" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
  if ($log) { "`n--- Last PostgreSQL log: $($log.FullName) ---"; Get-Content $log.FullName -Tail 200 }
}

Write-Host "== PostgreSQL password reset helper ==" -ForegroundColor Cyan
Write-Host "Service: $ServiceName" 
Write-Host "Bin:     $Bin"
Write-Host "DataDir: $DataDir"

# Sanity checks
if (-not (Test-Path $Bin)) { throw "Bin folder not found: $Bin" }
if (-not (Test-Path $DataDir)) { throw "Data dir not found: $DataDir" }
$psql = Join-Path $Bin "psql.exe"
$pgctl = Join-Path $Bin "pg_ctl.exe"
if (-not (Test-Path $psql)) { throw "psql.exe not found in $Bin" }
if (-not (Test-Path $pgctl)) { throw "pg_ctl.exe not found in $Bin" }

# Ensure service is installed
$svc = Get-Service $ServiceName -ErrorAction Stop
Write-Host "Service status: $($svc.Status)"

$hba = Join-Path $DataDir "pg_hba.conf"
if (-not (Test-Path $hba)) { throw "pg_hba.conf not found in $DataDir" }

# Backup
$backup = "$hba.bak_reset_$(Get-Date -Format 'yyyyMMdd_HHmmss')"
Copy-Item $hba $backup -Force
Write-Host "Backed up pg_hba.conf to $backup"

# Prepend trust lines ONLY for loopback
$trustLines = @(
  "host    all     all     127.0.0.1/32    trust",
  "host    all     all     ::1/128         trust"
) -join "`r`n"

# Add if not already present at top
$content = Get-Content $hba -Raw
$needsWrite = $true
if ($content -match '^\s*host\s+all\s+all\s+127\.0\.0\.1/32\s+trust' -and $content -match '^\s*host\s+all\s+all\s+::1/128\s+trust') {
  $needsWrite = $false
}
if ($needsWrite) {
  Set-Content -Path $hba -Value ($trustLines + "`r`n" + $content) -Encoding ASCII
  Write-Host "Prepended temporary trust lines for IPv4/IPv6 loopback."
} else {
  Write-Host "Trust lines already present (skipping prepend)."
}

# Restart service to apply HBA change
Write-Host "Restarting PostgreSQL service..." -ForegroundColor Yellow
try {
  Restart-Service $ServiceName -Force -ErrorAction Stop
  Start-Sleep -Seconds 2
} catch {
  Write-Warning "Restart-Service failed; trying pg_ctl..."
  & "$pgctl" restart -D "$DataDir" -w -t 60 | Out-Null
}
(Get-Service $ServiceName).Refresh()
Write-Host "Service status now: $((Get-Service $ServiceName).Status)"

if ((Get-Service $ServiceName).Status -ne "Running") {
  Write-Warning "Service is not running after restart."
  Tail-LastLog -DataDir $DataDir
  throw "Cannot proceed while service is down."
}

# Set new password (no password needed due to trust)
$env:PATH = "$Bin;$env:PATH"
Write-Host "Setting new password for role 'postgres'..." -ForegroundColor Yellow
& "$psql" -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "ALTER USER postgres WITH PASSWORD '$NewPassword';"

Write-Host "Password updated."

# Restore original HBA and restart
Write-Host "Restoring original pg_hba.conf and restarting service..." -ForegroundColor Yellow
Copy-Item $backup $hba -Force

try {
  Restart-Service $ServiceName -Force -ErrorAction Stop
  Start-Sleep -Seconds 2
} catch {
  & "$pgctl" restart -D "$DataDir" -w -t 60 | Out-Null
}

(Get-Service $ServiceName).Refresh()
if ((Get-Service $ServiceName).Status -ne "Running") {
  Write-Warning "Service failed to start after restoring HBA."
  Tail-LastLog -DataDir $DataDir
  throw "Service not running."
}

# Test login with the new password
$env:PGPASSWORD = $NewPassword
Write-Host "Testing connection with new password..." -ForegroundColor Yellow
& "$psql" -h 127.0.0.1 -U postgres -d postgres -c "select current_user, inet_server_addr();"

Write-Host "`nAll done. The 'postgres' user password has been reset." -ForegroundColor Green
