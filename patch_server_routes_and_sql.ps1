param(
  [string]$ServerPath = ".\server.js"
)

if (-not (Test-Path $ServerPath)) { throw "server.js not found at $ServerPath" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.$ts"
$txt = Get-Content -Raw $ServerPath

# 0) Ensure crypto import (CommonJS)
if ($txt -notmatch "require\(\s*['""]crypto['""]\s*\)") {
  # insert after last top-level require
  $txt = [regex]::Replace(
    $txt,
    "^(?<reqs>(\s*const\s+.*=\s*require\('.*'\);\s*\r?\n)+)",
    '${reqs}const crypto = require(''crypto'');' + "`r`n",
    'Multiline'
  )
}

# 1) Health route (missing in your audit)
if ($txt -notmatch "app\.get\(\s*['""]\/health['""]") {
  $health = @"
app.get('/health', async (req,res) => {
  try {
    const r = await pool.query('select now() as ts');
    res.json(['ok','db', true, 'up']);
  } catch (e) {
    console.error(e);
    res.status(500).json({error:'DB_DOWN'});
  }
});
"@
  # place after app.use(bodyParser.json())
  $txt = $txt -replace "app\.use\(\s*bodyParser\.json\(\)\s*\);\s*", "app.use(bodyParser.json());`r`n`r`n$health`r`n"
}

# 2) Period status route
if ($txt -notmatch "app\.get\(\s*['""]\/period\/status['""]") {
  $status = @"
app.get('/period/status', async (req,res) => {
  try {
    const {abn, taxType, periodId} = req.query;
    const r = await pool.query(`select * from periods where abn=$1 and tax_type=$2 and period_id=$3`, [abn, taxType, periodId]);
    if (r.rowCount === 0) return res.status(404).json({error:'NOT_FOUND'});
    res.json({ period: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({error:'INTERNAL'});
  }
});
"@
  # append near top: after health (if present) or after app.use
  if ($txt -match "app\.get\(\s*['""]\/health['""]") {
    $txt = $txt -replace "(app\.get\(\s*['""]\/health['""][\s\S]*?\}\);\s*)", '$0' + "`r`n$status`r`n"
  } else {
    $txt += "`r`n$status`r`n"
  }
}

# 3) Upgrade INSERT into rpt_tokens to 7 columns if still 5
$ins5 = "insert\s+into\s+rpt_tokens\s*\(\s*abn\s*,\s*tax_type\s*,\s*period_id\s*,\s*payload\s*,\s*signature\s*\)\s*values\s*\(\s*\$1\s*,\s*\$2\s*,\s*\$3\s*,\s*\$4\s*,\s*\$5\s*\)"
$ins7 = "insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values ($1,$2,$3,$4,$5,$6,$7)"
if ([regex]::IsMatch($txt, $ins5, 'IgnoreCase')) {
  $txt = [regex]::Replace($txt, $ins5, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $ins7 }, 'IgnoreCase')
}

# 4) Ensure the parameter array has 7 params (abn,taxType,periodId,payload,signature,payloadStr,payloadSha256)
$param5 = "\[\s*abn\s*,\s*taxType\s*,\s*periodId\s*,\s*payload\s*,\s*signature\s*\]"
$param7 = "[abn, taxType, periodId, payload, signature, payloadStr, payloadSha256]"
if ([regex]::IsMatch($txt, $param5)) {
  $txt = [regex]::Replace($txt, $param5, $param7)
}

# 5) Normalize /release SQL → owa_append($1,$2,$3,$4,$5) with vars [..., -amt, synthetic]
# Fix SQL text
$txt = [regex]::Replace(
  $txt,
  "select\s+\*\s+from\s+owa_append\s*\([\s\S]*?\)",
  "select * from owa_append($1,$2,$3,$4,$5)",
  'IgnoreCase'
)
# Fix argument array shape if needed: ensure -amt and synthetic are in the array
$txt = [regex]::Replace(
  $txt,
  "pool\.query\(\s*`select\s+\*\s+from\s+owa_append\(\$1,\$2,\$3,\$4,\$5\)`\s*,\s*\[\s*abn\s*,\s*taxType\s*,\s*periodId\s*,\s*-[a-zA-Z_]+\s*,\s*[a-zA-Z_]+\s*\]\s*\)",
  "pool.query(`select * from owa_append($1,$2,$3,$4,$5)`, [abn, taxType, periodId, -amt, synthetic])",
  'IgnoreCase'
)

# 6) Save
Set-Content -Path $ServerPath -Encoding UTF8 -Value $txt
Write-Host "Patched $ServerPath ✅"
