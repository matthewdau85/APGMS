param([string]$ServerPath = ".\server.js")

if (-not (Test-Path $ServerPath)) { throw "server.js not found at $ServerPath" }

$ts = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.$ts"

# Read file
$text = Get-Content -Path $ServerPath -Raw -Encoding UTF8

function InsertAfterFirst {
  param([string]$haystack,[string]$anchor,[string]$block)
  $idx = [Regex]::Match($haystack, $anchor, 'Singleline').Index
  if ($idx -ge 0) {
    $m = [Regex]::Match($haystack, $anchor, 'Singleline')
    $insertPos = $m.Index + $m.Length
    return $haystack.Substring(0,$insertPos) + "`r`n" + $block + "`r`n" + $haystack.Substring($insertPos)
  }
  return $haystack + "`r`n" + $block
}

# 0) Ensure crypto import is present
if (-not ([Regex]::IsMatch($text, "require\(\s*['""]crypto['""]\s*\)"))) {
  # add after last top-level require(...)
  $text = [Regex]::Replace($text,
    "(?<last>(?:^\s*const\s+.+?=\s*require\(['""][^'""]+['""]\);\s*$)(?![\s\S]*^\s*const\s+.+?=\s*require\(['""][^'""]+['""]\);\s*$))",
    '${last}' + "`r`n" + "const crypto = require('crypto');",
    'Multiline')
  if (-not ([Regex]::IsMatch($text, "require\(\s*['""]crypto['""]\s*\)"))) {
    $text = "const crypto = require('crypto');`r`n" + $text
  }
}

# 1) HEALTH route (exact shape the audit expects)
if (-not ([Regex]::IsMatch($text, "app\.get\(\s*['""]\/health['""]"))) {
  $health = @"
app.get('/health', async (req, res) => {
  try {
    const r = await pool.query('select now() as ts');
    res.json(['ok','db', true, 'up']);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'DB_DOWN' });
  }
});
"@
  # place after app.use(bodyParser.json())
  $text = InsertAfterFirst $text 'app\.use\(\s*bodyParser\.json\(\)\s*\);\s*' $health
}

# 2) PERIOD STATUS route (exact shape)
if (-not ([Regex]::IsMatch($text, "app\.get\(\s*['""]\/period\/status['""]"))) {
  $status = @"
app.get('/period/status', async (req, res) => {
  try {
    const { abn, taxType, periodId } = req.query;
    const r = await pool.query(
      \`select * from periods where abn=\$1 and tax_type=\$2 and period_id=\$3\`,
      [abn, taxType, periodId]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'NOT_FOUND' });
    res.json({ period: r.rows[0] });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'INTERNAL' });
  }
});
"@
  # place after /health block if present, else after app.use
  if ([Regex]::IsMatch($text, "app\.get\(\s*['""]\/health['""]")) {
    $text = InsertAfterFirst $text "app\.get\(\s*['""]\/health['""]" $status
  } else {
    $text = InsertAfterFirst $text 'app\.use\(\s*bodyParser\.json\(\)\s*\);\s*' $status
  }
}

# 3) Fix rpt_tokens insert to 7 columns (and exact VALUES placeholders)
#    a) Columns list
$text = [Regex]::Replace($text,
  "insert\s+into\s+rpt_tokens\s*\(\s*abn\s*,\s*tax_type\s*,\s*period_id\s*,\s*payload\s*,\s*signature\s*\)\s*values",
  "insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values",
  'IgnoreCase')

#    b) VALUES placeholders -> ($1..$7)
$text = [Regex]::Replace($text,
  "insert\s+into\s+rpt_tokens\([^)]*\)\s*values\s*\(\s*\$1\s*,\s*\$2\s*,\s*\$3\s*,\s*\$4\s*,\s*\$5\s*\)",
  "insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values ($1,$2,$3,$4,$5,$6,$7)",
  'IgnoreCase')

#    c) Param array must include payloadStr & payloadSha256
$text = [Regex]::Replace($text,
  "\[\s*abn\s*,\s*taxType\s*,\s*periodId\s*,\s*payload\s*,\s*signature\s*\]",
  "[abn, taxType, periodId, payload, signature, payloadStr, payloadSha256]",
  'IgnoreCase')

# 4) Normalize /release block: exact owa_append call lines and correct field read
#    a) Remove any scaffold like: from owa_append(,,,,) as t( ... )
$text = [Regex]::Replace($text,
  "^\s*from\s+owa_append\(\s*,\s*,\s*,\s*,\s*\)\s+as\s+t\([\s\S]*?\)\s*$",
  "",
  'IgnoreCase,Multiline')

#    b) Force the pool.query(...) signature inside /release to the two exact lines
#       Replace any line with pool.query that includes owa_append(...)
$text = [Regex]::Replace($text,
  "pool\.query\([^)]*owa_append[^)]*\)\s*,?\s*\r?\n\s*\[[^\]]*\][^;]*;",
  "pool.query(`select * from owa_append($1,$2,$3,$4,$5)`,
    [abn, taxType, periodId, -amt, synthetic]);",
  'IgnoreCase')

#    c) Ensure the response uses out_balance_after (from the function’s OUT column)
$text = [Regex]::Replace($text,
  "new_balance:\s*r\.rows\[0\]\.(balance_after|balance_after_cents)\b",
  "new_balance: r.rows[0].out_balance_after",
  'IgnoreCase')

#    d) Guard: if code references r.rows[0].balance_after anywhere in /release, fix it
$text = [Regex]::Replace($text,
  "r\.rows\[0\]\.balance_after\b",
  "r.rows[0].out_balance_after",
  'IgnoreCase')

# Save back
Set-Content -Path $ServerPath -Value $text -Encoding UTF8
Write-Host "Patched $ServerPath ✅"
