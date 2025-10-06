# File: codex_ingest_fixed.ps1 (part 1 of 2)
```powershell
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Root,
  [string]$OutDir,
  [int]$ChunkChars = 12000,
  [switch]$MakeCombined,
  [string]$IncludeExt = '.txt,.md,.markdown,.rst,.py,.js,.ts,.tsx,.jsx,.json,.yml,.yaml,.toml,.ini,.cfg,.ps1,.psm1,.psd1,.bat,.cmd,.sql,.html,.htm,.css,.scss,.less,.xml,.csv,.tsv,.sh,.rb,.go,.java,.kt,.c,.h,.hpp,.cpp,.cs',
  [string]$Exclude   = '.git*,node_modules*,dist*,build*,.venv*,.env*,__pycache__*,.mypy_cache*'
)
$LangMap = @{
  '.ps1'='powershell'; '.psm1'='powershell'; '.psd1'='powershell'
  '.py'='python'; '.js'='javascript'; '.ts'='typescript'; '.tsx'='tsx'; '.jsx'='jsx'
  '.json'='json'; '.yml'='yaml'; '.yaml'='yaml'; '.toml'='toml'; '.ini'='ini'; '.cfg'='ini'
  '.sql'='sql';  '.html'='html'; '.htm'='html'; '.css'='css'; '.scss'='scss'; '.less'='less'
  '.xml'='xml';   '.rb'='ruby'; '.go'='go';     '.java'='java'; '.kt'='kotlin'
  '.c'='c'; '.h'='c'; '.hpp'='cpp'; '.cpp'='cpp'; '.cs'='csharp'
  '.md'=''; '.markdown'=''; '.rst'=''; '.txt'=''
  '.bat'='batch'; '.cmd'='batch'; '.sh'='bash'; '.csv'='csv'; '.tsv'='tsv'
}
$RootPath = (Resolve-Path $Root).Path
if (-not $OutDir) { $OutDir = Join-Path $RootPath '_codex_feed' }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

$include = $IncludeExt.ToLower().Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }
$excludeGlobs = $Exclude.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }

$all = Get-ChildItem -Path $RootPath -Recurse -File -ErrorAction SilentlyContinue
$filtered = $all | Where-Object {
  $rel = $_.FullName.Substring($RootPath.Length).TrimStart('\','/')
  $ok = $true
  foreach ($g in $excludeGlobs) { if ($rel -like $g) { $ok = $false; break } }
  if (-not $ok) { return $false }
  $ext = $_.Extension.ToLower()
  $include -contains $ext
}

function Test-IsBinary([string]$path) {
  try {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    $sample = $bytes[0..([Math]::Min(2047, $bytes.Length-1))]
    $nonText = 0
    foreach ($b in $sample) {
      if ($b -eq 0) { return $true }
      if ($b -lt 9 -or ($b -gt 13 -and $b -lt 32)) { $nonText++ }
    }
    return ($nonText -gt 200)
  } catch { return $true }
}

function Split-Content([string]$text, [int]$max) {
  $parts = New-Object System.Collections.Generic.List[string]
  $start = 0
  while ($start -lt $text.Length) {
    $len   = [Math]::Min($max, $text.Length - $start)
    $slice = $text.Substring($start, $len)
    $break = $slice.LastIndexOf("`r`n`r`n"); if ($break -lt 0) { $break = $slice.LastIndexOf("`n`n") }
    if ($break -lt 0) { $break = $slice.LastIndexOf("`n") }
    if ($break -lt 1024) { $break = $len } else { $break += 1 }
    $parts.Add($text.Substring($start, $break))
    $start += $break
  }
  return ,$parts
}

$manifest = @()
$combinedPath = Join-Path $OutDir 'combined_all.md'
if (Test-Path $combinedPath) { Remove-Item $combinedPath -Force }

$index = 0
foreach ($f in $filtered) {
  if (Test-IsBinary $f.FullName) { continue }
  $rel = $f.FullName.Substring($RootPath.Length).TrimStart('\','/')
  $ext = $f.Extension.ToLower()
  $lang = $LangMap[$ext]; if ($null -eq $lang) { $lang = '' }

  $raw = Get-Content -LiteralPath $f.FullName -Raw -Encoding UTF8
  $raw = $raw -replace "`r`n", "`n"
  $safe = $raw -replace '`` `', '`` `'

  $parts = Split-Content -text $safe -max $ChunkChars
  $total = $parts.Count
  for ($i=0; $i -lt $total; $i++) {
    $index++; $partNum = $i+1
    $stem = ($rel -replace "[\\/:*?""<>|]", "_")
    $name = "{0:0000}_{1}_part_{2:00}of{3:00}.md" -f $index, $stem, $partNum, $total
    $outPath = Join-Path $OutDir $name

    $header = "# File: $rel (part $partNum of $total)`n"
    if ($lang -eq '') { $fenceOpen = '`` `' } else { $fenceOpen = '`` `' + $lang }
    $fenceClose = '`` `'

    $body = @($header, $fenceOpen, $parts[$i], $fenceClose)
    $content = ($body -join "`n")
    Set-Content -LiteralPath $outPath -Value $content -Encoding UTF8

    $manifest += [pscustomobject]@{
      order=$index; file_relative=$rel; part=$partNum; parts=$total
      md_path=$outPath; language=$lang; chars=$parts[$i].Length
    }

    if ($MakeCombined) {
      Add-Content -LiteralPath $combinedPath -Value $content -Encoding UTF8
      Add-Content -LiteralPath $combinedPath -Value "`n`n---`n`n" -Encoding UTF8
    }
  }
}

$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $OutDir 'manifest.json') -Encoding UTF8
$manifest | Export-Csv -LiteralPath (Join-Path $OutDir 'manifest.csv') -NoTypeInformation -Encoding UTF8

```

