<# 
  tools\phase9_release.ps1

  Phase 9 = Release & Publish
  - Validates repo
  - Builds Docker images (normalizer, tax-engine)
  - Tags images with version and latest
  - Optional: logs in and pushes to a registry (GHCR/Docker Hub/etc.)
  - Creates git tag and release notes

  Examples:
    # Local build only, auto-version by date
    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\phase9_release.ps1

    # Set explicit version and push to GHCR
    $env:REGISTRY_URL = 'ghcr.io'
    $env:IMAGE_NAMESPACE = 'your-gh-username/apgms'
    $env:REGISTRY_USER = 'your-gh-username'
    $env:REGISTRY_TOKEN = 'your_ghcr_token'  # a PAT with packages:write
    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\phase9_release.ps1 -Version 'v0.1.0' -Push
#>

[CmdletBinding()]
param(
  [string]$Version,
  [switch]$Push
)

function Info { param([string]$m) Write-Host "[ INFO ] $m" -ForegroundColor Cyan }
function Ok   { param([string]$m) Write-Host "[  OK  ] $m" -ForegroundColor Green }
function Warn { param([string]$m) Write-Host "[ WARN ] $m" -ForegroundColor Yellow }
function Err  { param([string]$m) Write-Host "[ ERR  ] $m" -ForegroundColor Red }

# Resolve repo root (robust across Windows PowerShell 5 and PowerShell 7)
function Get-RepoRoot {
  param([string]$StartPath)
  if (-not $StartPath -or [string]::IsNullOrWhiteSpace($StartPath)) { $StartPath = $MyInvocation.MyCommand.Path }
  if (-not $StartPath -or [string]::IsNullOrWhiteSpace($StartPath)) { $StartPath = (Get-Location).Path }
  $scriptDir = Split-Path -Path $StartPath -Parent
  if (-not $scriptDir -or [string]::IsNullOrWhiteSpace($scriptDir)) { $scriptDir = (Get-Location).Path }
  return (Resolve-Path (Join-Path $scriptDir '..')).Path
}

$RepoRoot = Get-RepoRoot $PSCommandPath
Set-Location $RepoRoot
Info "Repo root: $RepoRoot"

# Tools check
foreach ($cmd in @('git','docker')) {
  $has = Get-Command $cmd -ErrorAction SilentlyContinue
  if (-not $has) { Err "$cmd not found in PATH"; exit 1 }
}
Ok "Required tools present (git, docker)"

# Compute version if not provided
if (-not $Version -or [string]::IsNullOrWhiteSpace($Version)) {
  $Version = "v$(Get-Date -Format yyyy.MM.dd).0"
  Warn "No -Version provided; using $Version"
}

# Normalize version string (ensure starts with v)
if ($Version -notmatch '^v') { $Version = "v$Version" }
Info "Release version: $Version"

# Validate git status is clean
$gitStatus = (& git status --porcelain).Trim()
if ($gitStatus) {
  Warn "Working tree has uncommitted changes. Proceeding anyway."
} else {
  Ok "Working tree clean"
}

# Resolve registry settings
$REGISTRY_URL    = $env:REGISTRY_URL
$IMAGE_NAMESPACE = $env:IMAGE_NAMESPACE  # e.g. "youruser/apgms" or "org/apgms"
$REGISTRY_USER   = $env:REGISTRY_USER
$REGISTRY_TOKEN  = $env:REGISTRY_TOKEN

if ($Push) {
  if (-not $REGISTRY_URL -or -not $IMAGE_NAMESPACE -or -not $REGISTRY_USER -or -not $REGISTRY_TOKEN) {
    Err "Push requested but one or more env vars missing: REGISTRY_URL, IMAGE_NAMESPACE, REGISTRY_USER, REGISTRY_TOKEN"
    exit 1
  }
  Info "Will push to ${REGISTRY_URL}/${IMAGE_NAMESPACE}"
}

# Image names
$normalizerName = "normalizer"
$taxName        = "tax-engine"

# Build contexts
$normContext    = $RepoRoot
$normDockerfile = Join-Path $RepoRoot 'apps/services/event-normalizer/Dockerfile'
$taxContext     = Join-Path $RepoRoot 'apps/services/tax-engine'
$taxDockerfile  = Join-Path $taxContext 'Dockerfile'

# Local tags (always build)
$localNormalizerTagVersion = "apgms-final-${normalizerName}:${Version}"
$localNormalizerTagLatest  = "apgms-final-${normalizerName}:latest"
$localTaxTagVersion        = "apgms-final-${taxName}:${Version}"
$localTaxTagLatest         = "apgms-final-${taxName}:latest"

# Remote tags (only used if pushing)
$remoteNormalizerTagVersion = ""
$remoteNormalizerTagLatest  = ""
$remoteTaxTagVersion        = ""
$remoteTaxTagLatest         = ""
if ($Push) {
  $remoteNormalizerTagVersion = "${REGISTRY_URL}/${IMAGE_NAMESPACE}/${normalizerName}:${Version}"
  $remoteNormalizerTagLatest  = "${REGISTRY_URL}/${IMAGE_NAMESPACE}/${normalizerName}:latest"
  $remoteTaxTagVersion        = "${REGISTRY_URL}/${IMAGE_NAMESPACE}/${taxName}:${Version}"
  $remoteTaxTagLatest         = "${REGISTRY_URL}/${IMAGE_NAMESPACE}/${taxName}:latest"
}

# Build Normalizer
Info "Building image: $localNormalizerTagVersion"
& docker build `
  -f $normDockerfile `
  -t $localNormalizerTagVersion `
  -t $localNormalizerTagLatest `
  --build-arg BUILDKIT_INLINE_CACHE=1 `
  $normContext
if ($LASTEXITCODE -ne 0) { Err "Build failed: normalizer"; exit 1 }
Ok "Built normalizer"

# Build Tax Engine
Info "Building image: $localTaxTagVersion"
& docker build `
  -f $taxDockerfile `
  -t $localTaxTagVersion `
  -t $localTaxTagLatest `
  --build-arg BUILDKIT_INLINE_CACHE=1 `
  $taxContext
if ($LASTEXITCODE -ne 0) { Err "Build failed: tax-engine"; exit 1 }
Ok "Built tax-engine"

# Docker login and push (optional)
if ($Push) {
  Info "Logging in to ${REGISTRY_URL} as ${REGISTRY_USER}"
  $env:DOCKER_CLI_HINTS = "false"

  $pinfo = New-Object System.Diagnostics.ProcessStartInfo
  $pinfo.FileName = "docker"
  $pinfo.Arguments = "login ${REGISTRY_URL} -u ${REGISTRY_USER} --password-stdin"
  $pinfo.RedirectStandardInput = $true
  $pinfo.RedirectStandardOutput = $true
  $pinfo.RedirectStandardError = $true
  $pinfo.UseShellExecute = $false
  $proc = [System.Diagnostics.Process]::Start($pinfo)
  $proc.StandardInput.WriteLine($REGISTRY_TOKEN)
  $proc.StandardInput.Close()
  $proc.WaitForExit()
  if ($proc.ExitCode -ne 0) { Err "docker login failed"; exit 1 }
  Ok "docker login ok"

  # Tag to remote
  Info "Tagging images for remote"
  & docker tag $localNormalizerTagVersion $remoteNormalizerTagVersion
  & docker tag $localNormalizerTagLatest  $remoteNormalizerTagLatest
  & docker tag $localTaxTagVersion        $remoteTaxTagVersion
  & docker tag $localTaxTagLatest         $remoteTaxTagLatest

  # Push
  Info "Pushing images"
  foreach ($tag in @($remoteNormalizerTagVersion,$remoteNormalizerTagLatest,$remoteTaxTagVersion,$remoteTaxTagLatest)) {
    & docker push $tag
    if ($LASTEXITCODE -ne 0) { Err "Push failed: $tag"; exit 1 }
    Ok "Pushed $tag"
  }
}

# Git tag + release notes
$lastTag = (& git describe --tags --abbrev=0 2>$null)
if (-not $lastTag) { $lastTag = "" }

$notesPath = Join-Path $RepoRoot ("RELEASE_NOTES_" + $Version + ".md")
Info "Generating release notes: $notesPath"
$hdr = @()
$hdr += "# APGMS Release $Version"
$hdr += ""
$hdr += "## Images"
$hdr += ""
$hdr += "* normalizer: $localNormalizerTagVersion"
$hdr += "* tax-engine: $localTaxTagVersion"
if ($Push) {
  $hdr += ""
  $hdr += "### Pushed tags"
  $hdr += "* $remoteNormalizerTagVersion"
  $hdr += "* $remoteNormalizerTagLatest"
  $hdr += "* $remoteTaxTagVersion"
  $hdr += "* $remoteTaxTagLatest"
}

$hdr += ""
$hdr += "## Changes"
$hdr += ""

if ($lastTag) {
  $log = (& git log "$lastTag..HEAD" --pretty=format:"* %h %s (%an)")
} else {
  $log = (& git log --pretty=format:"* %h %s (%an)")
}
if (-not $log) { $log = @("* No commits found.") }

($hdr + $log) -join "`r`n" | Set-Content -Encoding UTF8 $notesPath
Ok "Release notes written"

# Create and push git tag
Info "Creating git tag $Version"
& git tag -a $Version -m "Release $Version"
if ($LASTEXITCODE -ne 0) {
  Warn "Could not create tag (maybe it exists already)."
} else {
  Ok "Tag created"
}

Info "Pushing tag $Version"
& git push origin $Version
if ($LASTEXITCODE -ne 0) {
  Warn "Could not push tag to origin (verify remote)."
} else {
  Ok "Tag pushed to origin"
}

Ok "Phase 9 complete."
Write-Host ""
Write-Host "Summary:" -ForegroundColor Cyan
Write-Host "  Version   : $Version"
Write-Host "  Notes     : $notesPath"
if ($Push) {
  Write-Host "  Registry  : $REGISTRY_URL" -ForegroundColor Cyan
  Write-Host "  Namespace : $IMAGE_NAMESPACE" -ForegroundColor Cyan
}
