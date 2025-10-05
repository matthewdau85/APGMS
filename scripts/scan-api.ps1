param(
  [string]$Path = "C:\Users\matth\OneDrive\Desktop\apgms-final\api",
  [int]$TopN = 15,
  [switch]$ExportCsv,
  [string]$OutDir = ".\scan_api_out"
)

if (-not (Test-Path -LiteralPath $Path)) { throw "Path not found: $Path" }

# Treat these as text for line counting
$TextExt = @(
  ".ts",".tsx",".js",".jsx",".mjs",".cjs",
  ".json",".md",".yaml",".yml",".env",".ps1",".psm1",".psd1",
  ".sql",".sh",".bat",".cmd",".ini",".cfg",".toml",".css",".scss",".less"
)

function Get-LineCount {
  param([string]$File)
  try {
    $count = 0
    $sr = New-Object System.IO.StreamReader($File)
    try {
      while ($null -ne ($sr.ReadLine())) { $count++ }
    } finally { $sr.Dispose() }
    return $count
  } catch { return $null }
}

function HumanBytes([Int64]$b) {
  if ($b -ge 1PB) { return "{0:n2} PB" -f ($b/1PB) }
  if ($b -ge 1TB) { return "{0:n2} TB" -f ($b/1TB) }
  if ($b -ge 1GB) { return "{0:n2} GB" -f ($b/1GB) }
  if ($b -ge 1MB) { return "{0:n2} MB" -f ($b/1MB) }
  if ($b -ge 1KB) { return "{0:n2} KB" -f ($b/1KB) }
  return "$b B"
}

Write-Host "== Scanning: $Path ==" -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()

$items = Get-ChildItem -LiteralPath $Path -Recurse -Force -ErrorAction SilentlyContinue
$dirs  = $items | Where-Object { $_.PSIsContainer }
$files = $items | Where-Object { -not $_.PSIsContainer }

$rows = @()

foreach ($f in $files) {
  $ext = $f.Extension
  if ($null -eq $ext) { $ext = "" }
  $ext = $ext.ToLowerInvariant()

  $isText = $TextExt -contains $ext
  $lc = $null
  if ($isText) { $lc = Get-LineCount -File $f.FullName }

  $todoCount = $null
  if ($isText -and $f.Length -lt 5MB) {
    try {
      $content = Get-Content -LiteralPath $f.FullName -Raw -EA SilentlyContinue
      if ($null -ne $content) {
        $m = [regex]::Matches($content, '(?im)\b(TODO|FIXME)\b')
        $todoCount = $m.Count
      }
    } catch { $todoCount = $null }
  }

  $rows += New-Object psobject -Property @{
    Name        = $f.Name
    FullName    = $f.FullName
    Directory   = $f.DirectoryName
    Extension   = $ext
    SizeBytes   = [int64]$f.Length
    Created     = $f.CreationTimeUtc
    Modified    = $f.LastWriteTimeUtc
    IsText      = [bool]$isText
    LineCount   = $lc
    TodoFixme   = $todoCount
  }
}

$sw.Stop()

$filesCount = ($rows | Measure-Object).Count
$totalBytes = ($rows | Measure-Object -Property SizeBytes -Sum).Sum

$largest = $rows | Sort-Object SizeBytes -Descending | Select-Object -First $TopN
$recent  = $rows | Sort-Object Modified  -Descending | Select-Object -First $TopN

$byExt = $rows |
  Group-Object Extension |
  ForEach-Object {
    $sumBytes = ($_.Group | Measure-Object -Property SizeBytes -Sum).Sum
    $lineGroups = $_.Group | Where-Object { $_.LineCount -ne $null }
    $sumLines = ($lineGroups | Measure-Object -Property LineCount -Sum).Sum
    $avgLines = $null
    if ($sumLines -and $_.Count) { $avgLines = [math]::Round($sumLines / $_.Count, 2) }
    New-Object psobject -Property @{
      Extension = (if ($_.Name -and $_.Name -ne "") { $_.Name } else { "<none>" })
      Files     = $_.Count
      Bytes     = $sumBytes
      Lines     = $sumLines
      AvgLines  = $avgLines
    }
  } | Sort-Object Bytes -Descending

$dupes = $rows |
  Group-Object Name |
  Where-Object { $_.Count -gt 1 } |
  ForEach-Object {
    New-Object psobject -Property @{
      Name        = $_.Name
      Occurrences = $_.Count
      Files       = ($_.Group.FullName -join "`n")
    }
  } | Sort-Object Occurrences -Descending

$todos = $rows | Where-Object { $_.TodoFixme -gt 0 } | Sort-Object TodoFixme -Descending

Write-Host ""
Write-Host "============== SCAN REPORT ==============" -ForegroundColor Yellow
("{0,-18}: {1}" -f "Root", $Path)                               | Write-Host
("{0,-18}: {1}" -f "Folders", $dirs.Count)                      | Write-Host
("{0,-18}: {1}" -f "Files", $filesCount)                        | Write-Host
("{0,-18}: {1}" -f "Total Size", (HumanBytes $totalBytes))      | Write-Host
("{0,-18}: {1} ms" -f "Elapsed", $sw.ElapsedMilliseconds)       | Write-Host
Write-Host "=========================================" -ForegroundColor Yellow

Write-Host "`n-- By Extension (top by size) --" -ForegroundColor Cyan
$byExt | Select-Object Extension, Files, @{n='Bytes';e={HumanBytes $_.Bytes}}, Lines, AvgLines | Format-Table -AutoSize

Write-Host "`n-- Largest $TopN files --" -ForegroundColor Cyan
$largest | Select-Object @{n='Size';e={HumanBytes $_.SizeBytes}}, FullName | Format-Table -AutoSize

Write-Host "`n-- Most recently modified $TopN --" -ForegroundColor Cyan
$recent | Select-Object Modified, FullName | Format-Table -AutoSize

if ($dupes -and $dupes.Count -gt 0) {
  Write-Host "`n-- Duplicate filenames --" -ForegroundColor Cyan
  $dupes | Select-Object Name, Occurrences | Format-Table -AutoSize
} else {
  Write-Host "`n-- Duplicate filenames -- none" -ForegroundColor DarkGray
}

if ($todos -and $todos.Count -gt 0) {
  Write-Host "`n-- TODO/FIXME hits --" -ForegroundColor Cyan
  $todos | Select-Object TodoFixme, FullName | Format-Table -AutoSize
} else {
  Write-Host "`n-- TODO/FIXME hits -- none" -ForegroundColor DarkGray
}

if ($ExportCsv) {
  if (-not (Test-Path -LiteralPath $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }
  $rows    | Export-Csv -LiteralPath (Join-Path $OutDir "files.csv")   -NoTypeInformation -Encoding UTF8
  $byExt   | Export-Csv -LiteralPath (Join-Path $OutDir "by_ext.csv")  -NoTypeInformation -Encoding UTF8
  $largest | Export-Csv -LiteralPath (Join-Path $OutDir "largest.csv") -NoTypeInformation -Encoding UTF8
  $recent  | Export-Csv -LiteralPath (Join-Path $OutDir "recent.csv")  -NoTypeInformation -Encoding UTF8
  $dupes   | Export-Csv -LiteralPath (Join-Path $OutDir "dupes.csv")   -NoTypeInformation -Encoding UTF8
  $todos   | Export-Csv -LiteralPath (Join-Path $OutDir "todos.csv")   -NoTypeInformation -Encoding UTF8
  Write-Host "`nCSV exports written to $OutDir" -ForegroundColor Green
}
