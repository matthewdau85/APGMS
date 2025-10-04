# fix_pkg_ps51.ps1
# PowerShell 5.1-safe package.json patcher (adds scripts, tidies deps)

$ErrorActionPreference = "Stop"
$pkgPath = ".\package.json"
if (!(Test-Path $pkgPath)) { throw "package.json not found in $(Get-Location)" }

function Convert-PSObjectToHashtable {
  param([Parameter(ValueFromPipeline=$true)] $InputObject)
  process {
    if ($null -eq $InputObject) { return $null }
    # Arrays / enumerables (but not strings)
    if ($InputObject -is [System.Collections.IEnumerable] -and -not ($InputObject -is [string])) {
      $list = @()
      foreach ($item in $InputObject) { $list += ,(Convert-PSObjectToHashtable $item) }
      return $list
    }
    # Objects
    if ($InputObject -is [psobject]) {
      $h = @{}
      foreach ($p in $InputObject.PSObject.Properties) {
        $h[$p.Name] = Convert-PSObjectToHashtable $p.Value
      }
      return $h
    }
    # Primitives
    return $InputObject
  }
}

# Read JSON -> PSCustomObject -> Hashtable (PS5.1 compatible)
$pkgJson = Get-Content $pkgPath -Raw
$pkgPSO  = $pkgJson | ConvertFrom-Json
$pkg     = Convert-PSObjectToHashtable $pkgPSO

# Ensure scripts
if (-not $pkg.ContainsKey("scripts")) { $pkg["scripts"] = @{} }
if (-not $pkg["scripts"].ContainsKey("build")) { $pkg["scripts"]["build"] = "tsc" }
if (-not $pkg["scripts"].ContainsKey("start")) { $pkg["scripts"]["start"] = "node dist/index.js" }
if (-not $pkg["scripts"].ContainsKey("dev"))   { $pkg["scripts"]["dev"]   = "ts-node src/index.ts" }

# Remove @types/uuid if present (uuid ships its own types)
if ($pkg.ContainsKey("devDependencies") -and $pkg["devDependencies"].ContainsKey("@types/uuid")) {
  $pkg["devDependencies"].Remove("@types/uuid")
}

# Write back
$pkg | ConvertTo-Json -Depth 100 | Set-Content -Path $pkgPath -Encoding UTF8
Write-Host "package.json patched for PS 5.1."
