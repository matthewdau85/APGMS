[CmdletBinding()]
param(
  [string]$RepoRoot = ".",
  [string]$DbHost,
  [string]$DbName,
  [string]$DbUser,
  [string]$DbPwd,
  [int]$DbPort
)

function Write-Section($t){Write-Host "`n== $t ==" -ForegroundColor Cyan}

function Read-DotEnv($p){
  $m=@{}
  if(-not(Test-Path $p)){ return $m }
  Get-Content $p | ForEach-Object {
    $l=$_.Trim()
    if($l -eq "" -or $l.StartsWith("#")){ return }
    $i=$l.IndexOf("="); if($i -lt 1){ return }
    $k=$l.Substring(0,$i).Trim()
    $v=$l.Substring($i+1).Trim()
    if($v.StartsWith('"') -and $v.EndsWith('"')){ $v=$v.Substring(1,$v.Length-2) }
    if($v.StartsWith("'") -and $v.EndsWith("'")){ $v=$v.Substring(1,$v.Length-2) }
    $m[$k]=$v
  }
  return $m
}

# Regex helper with explicit options
function T([string]$txt,[string]$pat){
  $opts = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase -bor `
          [System.Text.RegularExpressions.RegexOptions]::Multiline
  return [System.Text.RegularExpressions.Regex]::IsMatch($txt,$pat,$opts)
}

$RepoRoot=(Resolve-Path $RepoRoot).Path
Set-Location $RepoRoot
$envPath = Join-Path $RepoRoot ".env.local"
$envVars = Read-DotEnv $envPath

Write-Section "Repo"
$loaded = if(Test-Path $envPath){"yes"} else {"no"}
Write-Host ("Root: " + $RepoRoot)
Write-Host (".env.local loaded: " + $loaded)

Write-Section "DB defaults"
if(-not $DbHost){ $DbHost = $envVars["PGHOST"]; if(-not $DbHost){ $DbHost="127.0.0.1" } }
if(-not $DbName){ $DbName = $envVars["PGDATABASE"]; if(-not $DbName){ $DbName="apgms" } }
if(-not $DbUser){ $DbUser = $envVars["PGUSER"]; if(-not $DbUser){ $DbUser="apgms" } }
if(-not $DbPwd ){ $DbPwd  = $envVars["PGPASSWORD"]; if(-not $DbPwd ){ $DbPwd="" } }
if(-not $DbPort){
  $tmp = $envVars["PGPORT"]
  if([string]::IsNullOrWhiteSpace($tmp)){ $DbPort = 5432 } else { $DbPort = [int]$tmp }
}
Write-Host "PGHOST=$DbHost PGDATABASE=$DbName PGUSER=$DbUser PGPORT=$DbPort"

Write-Section "File checks"
$files=@(
  "server.js",
  "migrations\001_apgms_core.sql",
  "migrations\002_patent_extensions.sql",
  "scripts\seed_period.ps1",
  "verify_rpt.js",
  "export_evidence.js"
)
$missing=@()
foreach($f in $files){
  if(Test-Path $f){ Write-Host "[OK] $f" }
  else { Write-Host "[MISSING] $f" -ForegroundColor Yellow; $missing+=$f }
}

Write-Section "server.js audit"
$serverPath = Join-Path $RepoRoot "server.js"
if(-not(Test-Path $serverPath)){
  Write-Host "server.js not found, skipping." -ForegroundColor Yellow
}else{
  $s = Get-Content -Raw $serverPath
  Write-Host ("Health route: "                + $( if(T $s "app\.get\(\s*['""]\/health['""]\)"){"OK"}else{"MISSING"} ))
  Write-Host ("Period status route: "         + $( if(T $s "app\.get\(\s*['""]\/period\/status['""]\)"){"OK"}else{"MISSING"} ))
  Write-Host ("Canonical string present: "    + $( if(T $s "const\s+payloadStr\s*=\s*JSON\.stringify\(\s*payload\s*\)"){"OK"}else{"MISSING"} ))
  Write-Host ("SHA256 of canonical: "         + $( if(T $s "payloadSha256\s*=\s*crypto\.createHash\(\s*['""]sha256['""]\)"){"OK"}else{"MISSING"} ))
  Write-Host ("Signs canonical string: "      + $( if(T $s "new\s+TextEncoder\(\)\.encode\(\s*payloadStr\s*\)"){"OK"}else{"MISSING"} ))
  Write-Host ("crypto import present: "       + $( if(T $s "require\(\s*['""]crypto['""]\s*\)"){"OK"}else{"MISSING"} ))
  Write-Host ("RPT issue route: "             + $( if(T $s "app\.post\(\s*['""]\/rpt\/issue['""]\)"){"OK"}else{"MISSING"} ))
  $ins7="insert\s+into\s+rpt_tokens\s*\(\s*abn\s*,\s*tax_type\s*,\s*period_id\s*,\s*payload\s*,\s*signature\s*,\s*payload_c14n\s*,\s*payload_sha256\s*\)\s*values\s*\(\s*\$1\s*,\s*\$2\s*,\s*\$3\s*,\s*\$4\s*,\s*\$5\s*,\s*\$6\s*,\s*\$7\s*\)"
  Write-Host ("rpt_tokens insert(7): "         + $( if(T $s $ins7){"OK"}else{"NEEDS FIX"} ))
  $arr7="\[\s*abn\s*,\s*taxType\s*,\s*periodId\s*,\s*payload\s*,\s*signature\s*,\s*payloadStr\s*,\s*payloadSha256\s*\]"
  Write-Host ("param array (7 items): "        + $( if(T $s $arr7){"OK"}else{"NEEDS FIX"} ))
  Write-Host ("release -> owa_append(5): "     + $( if(T $s "owa_append\(\s*\$1\s*,\s*\$2\s*,\s*\$3\s*,\s*\$4\s*,\s*\$5\s*\)"){"OK"}else{"CHECK"} ))
  Write-Host ("accidental comma near FROM/WHERE: " + $( if(T $s "(from|where)\s*,\s"){"FOUND (fix)"}else{"none"} ))
}

Write-Section "DB audit (psql)"
$psql = Get-Command psql -ErrorAction SilentlyContinue
if(-not $psql){
  Write-Host "psql not found on PATH. Skipping DB audit." -ForegroundColor Yellow
}else{
  $pgArgs=@("-h",$DbHost,"-U",$DbUser,"-d",$DbName,"-p","$DbPort","-v","ON_ERROR_STOP=1")
  if($DbPwd -ne ""){ $env:PGPASSWORD=$DbPwd }

  $sqlTables=@"
select string_agg(relname, ',') as have
from pg_class
where relkind='r' and relname in ('periods','owa_ledger','rpt_tokens','remittance_destinations','audit_log','idempotency_keys');
"@
  $tbls = & psql $pgArgs -At -c $sqlTables
  if($LASTEXITCODE -eq 0){ Write-Host ("tables present: " + $tbls) } else { Write-Host "DB connection failed (tables check)." -ForegroundColor Yellow }

  $sqlCols=@"
select string_agg(attname, ',') as cols
from pg_attribute
where attrelid = 'rpt_tokens'::regclass and attnum>0 and not attisdropped
  and attname in ('payload_c14n','payload_sha256','payload','signature','abn','tax_type','period_id');
"@
  $cols = & psql $pgArgs -At -c $sqlCols
  if($LASTEXITCODE -eq 0){
    Write-Host ("rpt_tokens cols: " + $cols)
    if(($cols -notmatch "payload_c14n") -or ($cols -notmatch "payload_sha256")){
      Write-Host "-> Missing columns detected; run:" -ForegroundColor Yellow
      Write-Host "   ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS payload_c14n text;"
      Write-Host "   ALTER TABLE rpt_tokens ADD COLUMN IF NOT EXISTS payload_sha256 text;"
    }
  } else { Write-Host "DB connection failed (columns check)." -ForegroundColor Yellow }

  $sqlFn=@"
select proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and proname='owa_append';
"@
  $fn = & psql $pgArgs -At -c $sqlFn
  if($LASTEXITCODE -eq 0){
    if([string]::IsNullOrWhiteSpace($fn)){
      Write-Host "owa_append not found. Run 002_patent_extensions.sql." -ForegroundColor Yellow
    } else {
      Write-Host ("owa_append present: " + $fn)
    }
  } else { Write-Host "DB connection failed (function check)." -ForegroundColor Yellow }
}

Write-Section "Recommendations"
if($missing.Count -gt 0){ Write-Host ("* Missing files: " + ($missing -join ', ')) -ForegroundColor Yellow }
Write-Host "Audit complete." -ForegroundColor Green
