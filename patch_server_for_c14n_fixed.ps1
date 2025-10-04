param(
  [string]$ServerPath = ".\server.js"
)

if (-not (Test-Path $ServerPath)) { throw "server.js not found at $ServerPath" }

# Backup
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.$timestamp"

# Load
$content = Get-Content -Raw $ServerPath

# Already patched?
if ($content -match 'payload_c14n' -and $content -match 'payload_sha256' -and $content -match 'payloadStr') {
  Write-Host "Looks already patched. No changes made."
} else {
  # Ensure crypto import
  if ($content -notmatch "require\('crypto'\)") {
    $content = $content -replace "(?<lastreq>^(\s*const\s+.*=\s*require\('.*'\);\s*\r?\n)+)",
      '${lastreq}const crypto = require(''crypto'');' + "`r`n"
  }

  # Insert canonicalization block and switch signing target
  $insertBlock = @"
  // canonicalize: freeze the exact JSON string being signed and saved
  const payloadStr = JSON.stringify(payload);
  const payloadSha256 = crypto.createHash('sha256').update(payloadStr).digest('hex');
"@

  $patternEncode = "new\s+TextEncoder\(\)\.encode\(\s*JSON\.stringify\(\s*payload\s*\)\s*\)"
  $replacementEncode = (($insertBlock -replace "`r?`n","`r`n") + "new TextEncoder().encode(payloadStr)")
  if ($content -match $patternEncode) {
    $content = [regex]::Replace($content, $patternEncode, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $replacementEncode })
  } else {
    # Fallback: if encode() already uses payloadStr, ensure block exists right before first 'const msg ='
    if ($content -notmatch "const\s+payloadStr\s*=\s*JSON\.stringify\(payload\);") {
      $content = $content -replace "(const\s+msg\s*=\s*new\s+TextEncoder\(\)\.encode\()",
        ($insertBlock -replace "`r?`n","`r`n") + '$1'
    }
  }

  # Defensive: replace any remaining JSON.stringify(payload) in signing path
  $content = $content -replace "JSON\.stringify\(\s*payload\s*\)", "payloadStr"

  # Expand INSERT columns
  $patternInsertCols = "insert\s+into\s+rpt_tokens\s*\(\s*abn\s*,\s*tax_type\s*,\s*period_id\s*,\s*payload\s*,\s*signature\s*\)\s*values\s*\(\s*\$1\s*,\s*\$2\s*,\s*\$3\s*,\s*\$4\s*,\s*\$5\s*\)"
  $replacementInsertCols = "insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values ($1,$2,$3,$4,$5,$6,$7)"
  $content = [regex]::Replace($content, $patternInsertCols, $replacementInsertCols, 'IgnoreCase')

  # Expand parameter array
  $patternParams = "\[\s*abn\s*,\s*taxType\s*,\s*periodId\s*,\s*payload\s*,\s*signature\s*\]"
  $replacementParams = "[abn, taxType, periodId, payload, signature, payloadStr, payloadSha256]"
  $content = [regex]::Replace($content, $patternParams, $replacementParams)

  # Save
  Set-Content -Path $ServerPath -Value $content -Encoding UTF8
  Write-Host "Patched $ServerPath ✅"
}

# Make sure the DB has the extra columns (safe to re-run)
Write-Host "Ensuring rpt_tokens columns exist ..."
$psql = "psql"
$pgpw = if ($env:PGPASSWORD) { $env:PGPASSWORD } else { Read-Host -AsSecureString "Enter DB password" | ForEach-Object { [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($_)) } }
$pgArgs = @("host=127.0.0.1 dbname=apgms user=apgms password=$pgpw")
& $psql $pgArgs -v ON_ERROR_STOP=1 -c "ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS payload_c14n text; ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS payload_sha256 text;" | Out-Host

Write-Host "Done. Restart node and re-issue an RPT, then re-run verify."
