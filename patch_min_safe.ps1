param([string]$ServerPath = ".\server.js")

if (-not (Test-Path $ServerPath)) { throw "server.js not found at $ServerPath" }

$ts  = Get-Date -Format "yyyyMMdd_HHmmss"
Copy-Item $ServerPath "$ServerPath.bak.$ts"

# Load file into a single string and also lines array
$text  = Get-Content -Path $ServerPath -Raw -Encoding UTF8
$lines = $text -split "`r?`n"

function ContainsText([string]$hay,[string]$needle){
  return [System.Text.RegularExpressions.Regex]::IsMatch($hay, $needle,
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor
    [System.Text.RegularExpressions.RegexOptions]::Singleline)
}

# 0) Ensure crypto import (CommonJS)
if (-not (ContainsText $text "require\(\s*['""]crypto['""]\s*\)")) {
  # Insert after the last top-level require(...)
  $idx = -1
  for ($i=0; $i -lt $lines.Length; $i++){
    if ($lines[$i] -match "^\s*const\s+.+?=\s*require\('.*'\);\s*$"){ $idx = $i }
  }
  if ($idx -ge 0) {
    $lines = $lines[0..$idx] + @("const crypto = require('crypto');") + $lines[($idx+1)..($lines.Length-1)]
  } else {
    $lines = @("const crypto = require('crypto');") + $lines
  }
}

# Helper: insert block after a line that matches a pattern (first match)
function InsertAfterFirstMatch([string[]]$lns,[string]$pattern,[string[]]$block){
  for ($i=0; $i -lt $lns.Length; $i++){
    if ($lns[$i] -match $pattern){
      $pre  = $lns[0..$i]
      $post = $lns[($i+1)..($lns.Length-1)]
      return $pre + $block + $post
    }
  }
  return $lns + $block
}

# 1) /health route
if (-not (ContainsText $text "app\.get\(\s*['""]\/health['""]")) {
  $healthBlock = @(
    "app.get('/health', async (req,res) => {",
    "  try {",
    "    const r = await pool.query('select now() as ts');",
    "    res.json(['ok','db', true, 'up']);",
    "  } catch (e) {",
    "    console.error(e);",
    "    res.status(500).json({error:'DB_DOWN'});",
    "  }",
    "});",
    ""
  )
  # place after app.use(bodyParser.json())
  $lines = InsertAfterFirstMatch $lines 'app\.use\(\s*bodyParser\.json\(\)\s*\);' $healthBlock
}

# 2) /period/status route
if (-not (ContainsText $text "app\.get\(\s*['""]\/period\/status['""]")) {
  $statusBlock = @(
    "app.get('/period/status', async (req,res) => {",
    "  try {",
    "    const {abn, taxType, periodId} = req.query;",
    "    const r = await pool.query(`select * from periods where abn=$1 and tax_type=$2 and period_id=$3`, [abn, taxType, periodId]);",
    "    if (r.rowCount === 0) return res.status(404).json({error:'NOT_FOUND'});",
    "    res.json({ period: r.rows[0] });",
    "  } catch (e) {",
    "    console.error(e);",
    "    res.status(500).json({error:'INTERNAL'});",
    "  }",
    "});",
    ""
  )
  # insert after /health if we just added it; otherwise after app.use
  if (ContainsText (($lines -join "`r`n")) "app\.get\(\s*['""]\/health['""]") {
    $lines = InsertAfterFirstMatch $lines "app\.get\(\s*['""]\/health['""]" $statusBlock
  } else {
    $lines = InsertAfterFirstMatch $lines 'app\.use\(\s*bodyParser\.json\(\)\s*\);' $statusBlock
  }
}

# 3) Upgrade INSERT into rpt_tokens to 7 columns (if still 5)
#    We replace the exact 5-col text, which is what your audit detected.
for ($i=0; $i -lt $lines.Length; $i++){
  if ($lines[$i] -match "insert\s+into\s+rpt_tokens\s*\(\s*abn\s*,\s*tax_type\s*,\s*period_id\s*,\s*payload\s*,\s*signature\s*\)\s*values\s*\(\s*\$1\s*,\s*\$2\s*,\s*\$3\s*,\s*\$4\s*,\s*\$5\s*\)" ){
    $lines[$i] = "    `insert into rpt_tokens(abn,tax_type,period_id,payload,signature,payload_c14n,payload_sha256) values ($1,$2,$3,$4,$5,$6,$7)`,"
  }
}

# 4) Ensure 7-item param array [abn, taxType, periodId, payload, signature, payloadStr, payloadSha256]
for ($i=0; $i -lt $lines.Length; $i++){
  if ($lines[$i] -match "\[\s*abn\s*,\s*taxType\s*,\s*periodId\s*,\s*payload\s*,\s*signature\s*\]"){
    $lines[$i] = "    [abn, taxType, periodId, payload, signature, payloadStr, payloadSha256]"
  }
}

# 5) Normalize /release call -> exact SQL + args
#    We look for the first pool.query line inside /release and force the two lines.
$releaseStart = -1
for ($i=0; $i -lt $lines.Length; $i++){
  if ($lines[$i] -match "app\.post\(\s*['""]\/release['""]") { $releaseStart = $i; break }
}
if ($releaseStart -ge 0) {
  for ($k=$releaseStart; $k -lt [Math]::Min($releaseStart+200, $lines.Length); $k++){
    if ($lines[$k] -match "pool\.query\(" -and $lines[$k] -match "owa_append"){
      # Force the SQL line (use backticks to keep template literal)
      $lines[$k] = "  const r = await pool.query(`select * from owa_append($1,$2,$3,$4,$5)`,"
      # Next line should be the array
      if ($k+1 -lt $lines.Length) {
        $after = $lines[$k+1]
        $tail  = ($after -replace '.*\]', '') # keep any closing )), etc
        $lines[$k+1] = "    [abn, taxType, periodId, -amt, synthetic]" + $tail
      } else {
        $lines += "    [abn, taxType, periodId, -amt, synthetic]);"
      }
      break
    }
  }
}

# Save back
$out = ($lines -join "`r`n")
Set-Content -Path $ServerPath -Value $out -Encoding UTF8
Write-Host "Patched $ServerPath ✅"
