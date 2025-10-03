param([switch]$Remove)
$root = Resolve-Path "."
Write-Host "Scanning: $root" -ForegroundColor Cyan
$globs = @(
  "**/__pycache__", "**/*.pyc", "**/.pytest_cache", "**/.mypy_cache",
  "**/.ruff_cache", "**/.coverage*", "**/htmlcov", "**/*.log", "**/*.tmp",
  "**/.DS_Store", "**/Thumbs.db", "**/.ipynb_checkpoints", "**/dist", "**/build", "**/.tox"
)
$exclusions = @(".git",".venv","libs/json","apps/services","docker-data")
function Should-Exclude($p){ foreach($e in $exclusions){ if($p -like (Join-Path $root $e) + "*"){return $true} } return $false }
$targets = New-Object System.Collections.Generic.List[string]
foreach($g in $globs){
  Get-ChildItem -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue -Filter (Split-Path $g -Leaf) |
    ForEach-Object{
      $full=$_.FullName
      $patternDir = Split-Path $g
      if($patternDir -and ($full -notlike "*$patternDir*")){return}
      if(-not (Should-Exclude $full)){$targets.Add($full)}
    }
}
$targets = $targets | Sort-Object -Unique
if(-not $targets.Count){ Write-Host "Nothing to clean." -ForegroundColor Green; exit 0 }
Write-Host "Found $($targets.Count) candidate path(s):" -ForegroundColor Yellow
$targets | ForEach-Object { Write-Host "  $_" }
if($Remove){
  Write-Host "`nRemoving..." -ForegroundColor Red
  foreach($t in $targets){
    try{
      if(Test-Path $t -PathType Container){ Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction Stop }
      else{ Remove-Item -LiteralPath $t -Force -ErrorAction Stop }
      Write-Host "  [deleted] $t"
    } catch {
      Write-Warning "  [skipped] $t :: $($_.Exception.Message)"
    }
  }
  Write-Host "Cleanup done." -ForegroundColor Green
}else{
  Write-Host "`n(Dry run) Use -Remove to delete the above." -ForegroundColor Cyan
}
