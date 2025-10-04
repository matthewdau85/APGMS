# scripts/fix_insert_7params.ps1
param(
  [string]$ServerPath = ".\server.js"
)

if (-not (Test-Path $ServerPath)) {
  throw "server.js not found at $ServerPath"
}

# Backup
$stamp = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.$stamp"

# Load
$content = Get-Content -Raw $ServerPath
$orig = $content

# --- 1) Force INSERT to use 7 columns/placeholders -------------------------
# Matches even across newlines/whitespace
$regexOptions = [System.Text.RegularExpressions.RegexOptions] "IgnoreCase, Singleline"

$patternInsert = @"
insert\s+into\s+rpt_tokens\s*\(
\s*abn\s*,\s*tax_type\s*,\s*period_id\s*,\s*payload\s*,\s*signature\s*
\)\s*values\s*\(
\s*\$1\s*,\s*\$2\s*,\s*\$3\s*,\s*\$4\s*,\s*\$5\s*
\)
"@

$replacementInsert = "insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values ($1,$2,$3,$4,$5,$6,$7)"

if ([regex]::IsMatch($content, $patternInsert, $regexOptions)) {
  $content = [regex]::Replace($content, $patternInsert, $replacementInsert, $regexOptions)
}

# Also catch variants where columns are the same but VALUES are on multiple lines
$patternInsertLoose = @"
insert\s+into\s+rpt_tokens\s*\(
\s*abn\s*,\s*tax_type\s*,\s*period_id\s*,\s*payload\s*,\s*signature\s*
\)\s*values\s*\(
\s*\$1\s*,\s*\$2\s*,\s*\$3\s*,\s*\$4\s*,\s*\$5\s*
"@

if ([regex]::IsMatch($content, $patternInsertLoose, $regexOptions)) {
  $content = [regex]::Replace($content, $patternInsertLoose, "insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values (`$1,`$2,`$3,`$4,`$5,`$6,`$7", $regexOptions)
}

# --- 2) Force the JS params array to include payloadStr, payloadSha256 -----
$patternParams = "\[\s*abn\s*,\s*taxType\s*,\s*periodId\s*,\s*payload\s*,\s*signature\s*\]"
$replacementParams = "[abn, taxType, periodId, payload, signature, payloadStr, payloadSha256]"
$content = [regex]::Replace($content, $patternParams, $replacementParams, $regexOptions)

# --- 3) Ensure the canonicalization block exists and signing uses it -------
if ($content -notmatch "const\s+payloadStr\s*=\s*JSON\.stringify\(payload\);") {
  # Insert just before 'const sig = nacl.sign.detached' line
  $canonBlock = @"
  // === canonicalize payload ===
  const payloadStr = JSON.stringify(payload);
  const payloadSha256 = require('crypto').createHash('sha256').update(payloadStr).digest('hex');
  // ============================
"@
  $content = [regex]::Replace(
    $content,
    "(\r?\n)\s*const\s+sig\s*=\s*nacl\.sign\.detached",
    { param($m) ($canonBlock -replace "`r?`n","`r`n") + $m.Value },
    $regexOptions
  )
}

# Make sure TextEncoder encodes payloadStr (not JSON.stringify(payload))
$content = [regex]::Replace(
  $content,
  "new\s+TextEncoder\(\)\.encode\(\s*JSON\.stringify\(\s*payload\s*\)\s*\)",
  "new TextEncoder().encode(payloadStr)",
  $regexOptions
)

# Save if changed
if ($content -ne $orig) {
  Set-Content -Path $ServerPath -Value $content -Encoding UTF8
  Write-Host "Patched $ServerPath ✅"
} else {
  Write-Host "No changes made (already correct?)"
}

# Optional: show the final INSERT and the params line for sanity
Write-Host "`n--- INSERT preview ---"
$insertPreview = Select-String -Path $ServerPath -Pattern "insert\s+into\s+rpt_tokens" -AllMatches
$insertPreview | ForEach-Object { $_.Line } | Write-Host

Write-Host "`n--- params preview ---"
$paramPreview = Select-String -Path $ServerPath -Pattern "\[\s*abn\s*,\s*taxType\s*,\s*periodId\s*,\s*payload\s*,\s*signature" -AllMatches
$paramPreview | ForEach-Object { $_.Line } | Write-Host
