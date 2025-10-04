# scripts/generate-diagnostics.ps1
# Creates apgms_diagnostics.txt with environment, files, key contents, docker & pytest status.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

# --- Helpers -----------------------------------------------------------------
$sb = New-Object System.Text.StringBuilder
function Add-Line($text="") { [void]$sb.AppendLine($text) }
function Add-Section($title) {
  Add-Line ('=' * 100)
  Add-Line "## $title"
  Add-Line ('=' * 100)
}
function Run-Cmd($title, $cmd, $args=@()) {
  Add-Section $title
  try {
    $p = Start-Process -FilePath $cmd -ArgumentList $args -NoNewWindow -PassThru -RedirectStandardOutput out.txt -RedirectStandardError err.txt
    $null = $p.WaitForExit()
    $out = if (Test-Path out.txt) { Get-Content out.txt -Raw } else { "" }
    $err = if (Test-Path err.txt) { Get-Content err.txt -Raw } else { "" }
    if ($out) { Add-Line $out.TrimEnd() }
    if ($err) { Add-Line ""; Add-Line "STDERR:"; Add-Line $err.TrimEnd() }
  } catch {
    Add-Line "ERROR running $cmd $args : $($_.Exception.Message)"
  } finally {
    Remove-Item out.txt, err.txt -ErrorAction SilentlyContinue
  }
}
function Add-File($path) {
  Add-Section "File: $path"
  if (Test-Path $path) {
    try { Add-Line (Get-Content $path -Raw) } catch { Add-Line "ERROR reading file: $($_.Exception.Message)" }
  } else {
    Add-Line "(not found)"
  }
}
function Add-Http($title, $url) {
  Add-Section $title
  try {
    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
    Add-Line "StatusCode: $($resp.StatusCode)"
    Add-Line "----"
    Add-Line ($resp.Content)
  } catch {
    Add-Line "Request to $url failed: $($_.Exception.Message)"
  }
}

# --- Start -------------------------------------------------------------------
$reportPath = Join-Path (Get-Location) "apgms_diagnostics.txt"
$startedAt  = Get-Date

Add-Section "Context"
Add-Line "Timestamp: $startedAt"
Add-Line "Repo Root: $(Get-Location)"
Add-Line "User: $env:USERNAME"
Add-Line "OS: $([System.Environment]::OSVersion.VersionString)"
Add-Line "PSVersion: $($PSVersionTable.PSVersion)"
Add-Line "VIRTUAL_ENV: $env:VIRTUAL_ENV"
Add-Line ""

# Git status (if available)
if (Get-Command git -ErrorAction SilentlyContinue) {
  Run-Cmd "Git: status & head" "git" @("status","-sb")
  Run-Cmd "Git: current commit" "git" @("rev-parse","--short","HEAD")
} else { Add-Section "Git"; Add-Line "(git not found)" }

# Python & Poetry
if (Get-Command python -ErrorAction SilentlyContinue) {
  Run-Cmd "Python: version" "python" @("-V")
  Run-Cmd "Pip: version" "python" @("-m","pip","-V")
} else { Add-Section "Python"; Add-Line "(python not found)" }

if (Get-Command poetry -ErrorAction SilentlyContinue) {
  Run-Cmd "Poetry: version" "poetry" @("--version")
} else { Add-Section "Poetry"; Add-Line "(poetry not found)" }

# Project structure
Add-Section "Project tree (key files)"
$include = @("*.py","Dockerfile","pyproject.toml","poetry.lock","pytest.ini","docker-compose.yml")
try {
  Get-ChildItem -Recurse -File -Include $include |
    Sort-Object FullName |
    ForEach-Object { Add-Line ("{0}  ({1} bytes)  {2}" -f $_.FullName, $_.Length, $_.LastWriteTime) }
} catch {
  Add-Line "ERROR walking tree: $($_.Exception.Message)"
}

# Critical file contents
Add-File "pytest.ini"
Add-File "docker-compose.yml"
Add-File "apps/services/tax-engine/pyproject.toml"
Add-File "apps/services/tax-engine/Dockerfile"
Add-File "apps/services/tax-engine/app/main.py"
Add-File "apps/services/tax-engine/app/tax_rules.py"
Add-File "apps/services/event-normalizer/pyproject.toml"
Add-File "apps/services/event-normalizer/Dockerfile"
Add-File "apps/services/event-normalizer/app/main.py"
Add-File "apps/services/event-normalizer/app/__init__.py"
Add-File "apps/services/tax-engine/app/__init__.py"
Add-File "apps/services/tax-engine/tests/test_tax_rules.py"

# Pytest (quiet)
if (Get-Command pytest -ErrorAction SilentlyContinue) {
  Run-Cmd "Pytest (-q)" "pytest" @("-q")
} else { Add-Section "Pytest"; Add-Line "(pytest not found)" }

# Docker & Compose
if (Get-Command docker -ErrorAction SilentlyContinue) {
  Run-Cmd "Docker: info (short)" "docker" @("info","--format","'Server: {{.ServerVersion}} | Product: {{.Product}}'")
  Run-Cmd "Docker images (apgms-related)" "docker" @("images","--format","table {{.Repository}}\t{{.Tag}}\t{{.ID}}\t{{.CreatedSince}}") 
  Run-Cmd "Docker compose: ps" "docker" @("compose","ps")

  # Try container logs if present
  foreach ($svc in @("apgms-final-nats-1","apgms-final-normalizer-1","apgms-final-tax-engine-1","nats","normalizer","tax-engine")) {
    Add-Section "docker logs $svc (tail 200)"
    try { Add-Line ((docker logs $svc --tail 200) -join "`n") } catch { Add-Line "(no such container or error: $($_.Exception.Message))" }
  }
} else {
  Add-Section "Docker"
  Add-Line "(docker not found)"
}

# Local HTTP health/metrics checks
Add-Http "Normalizer /healthz" "http://localhost:8001/healthz"
Add-Http "Tax-Engine /healthz" "http://localhost:8002/healthz"
Add-Http "NATS /healthz (monitoring)" "http://localhost:8222/healthz"
Add-Http "Normalizer /metrics (grep normalizer counters)" "http://localhost:8001/metrics"
Add-Http "Tax-Engine /metrics (grep tax-engine counters)" "http://localhost:8002/metrics"

# Save report
"Writing report to $reportPath"
$encoding = if ($PSVersionTable.PSEdition -eq "Core") { "utf8" } else { "ascii" }  # avoid BOM issues on older PowerShell
$sb.ToString() | Out-File -FilePath $reportPath -Encoding $encoding -Force

Add-Section "Done"
Add-Line "Finished: $(Get-Date)"
$sb.ToString()
