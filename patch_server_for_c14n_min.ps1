param(
  [string]$ServerPath = ".\server.js"
)

if (-not (Test-Path $ServerPath)) { throw "server.js not found at $ServerPath" }

# Backup
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.$timestamp"

# Load
$txt = Get-Content -Raw $ServerPath

function Ensure-CryptoImport([string]$s){
  if ($s -notmatch "require\('crypto'\)") {
    # insert after the last top-level require(...)
    $lines = $s -split "`r?`n"
    $lastReq = ($lines | Select-String -Pattern "^\s*const\s+.+=\s*require\('.+'\);\s*$" | Select-Object -Last 1).LineNumber
    if ($lastReq) {
      $idx = [int]$lastReq
      $before = $lines[0..($idx-1)]
      $after  = $lines[$idx..($lines.Count-1)]
      $s = ($before + "const crypto = require('crypto');" + $after) -join "`r`n"
    } else {
      $s = "const crypto = require('crypto');`r`n" + $s
    }
  }
  return $s
}

function Ensure-CanonicalSigning([string]$s){
  if ($s -match "new\s+TextEncoder\(\)\.encode\(\s*JSON\.stringify\(\s*payload\s*\)\s*\)") {
    # Insert payloadStr/payloadSha256 just before the encode() call, and switch to payloadStr
    $s = $s -replace "new\s+TextEncoder\(\)\.encode\(\s*JSON\.stringify\(\s*payload\s*\)\s*\)",
      ("// canonicalize: freeze exact JSON being signed`r`n" +
       "  const payloadStr = JSON.stringify(payload);`r`n" +
       "  const payloadSha256 = crypto.createHash('sha256').update(payloadStr).digest('hex');`r`n" +
       "  new TextEncoder().encode(payloadStr)")
  } elseif ($s -match "const\s+msg\s*=\s*new\s+TextEncoder\(\)\.encode\(") {
    # Fallback: find the 'const msg = new TextEncoder().encode(' line, ensure we compute payloadStr first
    $lines = $s -split "`r?`n"
    for ($i=0; $i -lt $lines.Count; $i++){
      if ($lines[$i] -match "const\s+msg\s*=\s*new\s+TextEncoder\(\)\.encode\(") {
        # Insert canonicalization block just above this line if we don't already have payloadStr
        if ($s -notmatch "const\s+payloadStr\s*=\s*JSON\.stringify\(payload\);") {
          $lines = $lines[0..($i-1)] + @(
            "  // canonicalize: freeze exact JSON being signed",
            "  const payloadStr = JSON.stringify(payload);",
            "  const payloadSha256 = crypto.createHash('sha256').update(payloadStr).digest('hex');"
          ) + $lines[$i..($lines.Count-1)]
          $i += 3
        }
        # Make sure the encode() uses payloadStr
        $lines[$i] = ($lines[$i] -replace "JSON\.stringify\(\s*payload\s*\)", "payloadStr")
        if ($lines[$i] -match "encode\(\s*payload\s*\)") {
          $lines[$i] = ($lines[$i] -replace "encode\(\s*payload\s*\)", "encode(payloadStr)")
        }
        $s = $lines -join "`r`n"
        break
      }
    }
  }
  return $s
}

function Expand-Insert([string]$s){
  # Expand insert columns/params if the old 5-column form exists
  $pattern = "insert\s+into\s+rpt_tokens\s*\(\s*abn\s*,\s*tax_type\s*,\s*period_id\s*,\s*payload\s*,\s*signature\s*\)\s*values\s*\(\s*\$1\s*,\s*\$2\s*,\s*\$3\s*,\s*\$4\s*,\s*\$5\s*\)"
  if ($s -match $pattern) {
    $s = [regex]::Replace($s, $pattern,
      "insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values ($1,$2,$3,$4,$5,$6,$7)",
      'IgnoreCase')
  }

  # Expand parameter array
  $patternParams = "\[\s*abn\s*,\s*taxType\s*,\s*periodId\s*,\s*payload\s*,\s*signature\s*\]"
  if ($s -match $patternParams) {
    $s = [regex]::Replace($s, $patternParams,
      "[abn, taxType, periodId, payload, signature, payloadStr, payloadSha256]")
  }
  return $s
}

$txt = Ensure-CryptoImport $txt
$txt = Ensure-CanonicalSigning $txt
$txt = Expand-Insert $txt

# Save
Set-Content -Path $ServerPath -Value $txt -Encoding UTF8
Write-Host "Patched $ServerPath ✅"

# Ensure DB columns exist (idempotent)
Write-Host "Ensuring rpt_tokens columns exist ..."
$psql = "psql"
$pgpw = if ($env:PGPASSWORD) { $env:PGPASSWORD } else { "apgms_pw" } # fallback to your demo pw
$pgArgs = @("host=127.0.0.1 dbname=apgms user=apgms password=$pgpw")
& $psql $pgArgs -v ON_ERROR_STOP=1 -c "ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS payload_c14n text; ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS payload_sha256 text;" | Out-Host
Write-Host "Done."
