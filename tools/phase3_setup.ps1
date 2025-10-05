# tools\phase3_fix_publish.ps1
$ErrorActionPreference = 'Stop'
$path = "apps/services/tax-engine/app/main.py"
if (-not (Test-Path $path)) { Write-Error "Missing $path"; exit 1 }

# Backup once
$bak = "$path.bak.phase3fix"
if (-not (Test-Path $bak)) { Copy-Item $path $bak -Force }

$src = Get-Content $path -Raw

# 1) Ensure we have SUBJECT_TAX
if ($src -notmatch '(?m)^\s*SUBJECT_TAX\s*=\s*["'']apgms\.tax\.v1["'']') {
  $src = $src -replace '(?m)^(.*SUBJECT_POS\s*=\s*["'']apgms\.pos\.v1["''].*)$', "`$1`r`nSUBJECT_TAX = `"apgms.tax.v1`""
}

# 2) Replace any "publish(evt)" with a wrapped result that includes event_type and total_tax_cents
# We build 'res' right before the publish and send that
$pattern = '(?m)^\s*await\s+_nc_tax\.publish\(\s*(?:SUBJECT_TAX|["'']apgms\.tax\.v1["''])\s*,\s*orjson\.dumps\(\s*evt\s*\)\s*\)\s*$'
if ($src -match $pattern) {
  $replacement = @'
        # Phase 3: publish a result envelope
        try:
            _total_tax = 0
            for _line in evt.get("lines", []):
                _total_tax += int(_line.get("gst_cents", 0))
            res = {"event_type":"pos_tax_result","total_tax_cents":int(_total_tax),"lines":evt.get("lines", [])}
            await _nc_tax.publish(SUBJECT_TAX, orjson.dumps(res))
        except Exception:
            # fallback: still publish original evt if wrapping failed
            await _nc_tax.publish(SUBJECT_TAX, orjson.dumps(evt))
'@
  $src = [regex]::Replace($src, $pattern, $replacement)
} else {
  Write-Host "Did not find a direct publish(evt) line; inserting a wrapped publish near end of _phase2_handle_pos." -ForegroundColor Yellow
  $src = $src -replace '(?s)(async\s+def\s+_phase2_handle_pos\([^\)]*\):\s*.*?\bev[tn]\s*=\s*orjson\.loads\(msg\.data\).*?)(\r?\n\s*#\s*optional:.*?publish|\r?\n\s*except\s+Exception:|\r?\n\Z)',
                      "`$1`r`n        # Phase 3 publish`r`n        try:`r`n            _total_tax = 0`r`n            for _line in evt.get('lines', []):`r`n                _total_tax += int(_line.get('gst_cents', 0))`r`n            res = {'event_type':'pos_tax_result','total_tax_cents':int(_total_tax),'lines':evt.get('lines', [])}`r`n            await _nc_tax.publish(SUBJECT_TAX, orjson.dumps(res))`r`n        except Exception:`r`n            pass`r`n`$2"
}

Set-Content -Path $path -Value $src -Encoding UTF8
Write-Host "Patched $path" -ForegroundColor Green

# Rebuild & restart just the service
Write-Host "Rebuilding tax-engine..." -ForegroundColor Cyan
docker compose build tax-engine | Out-Null
Write-Host "Restarting tax-engine..." -ForegroundColor Cyan
docker compose up -d tax-engine | Out-Null

# Quick smoke: wait for health
function Test-HttpOk($Url,[int]$TimeoutSec=45,[int]$RetryMs=700){
  $sw=[Diagnostics.Stopwatch]::StartNew()
  while ($sw.Elapsed.TotalSeconds -lt $TimeoutSec) {
    try { $r=iwr -UseBasicParsing -TimeoutSec 5 -Uri $Url; if($r.StatusCode -ge 200 -and $r.StatusCode -lt 300){return $true} } catch {}
    Start-Sleep -Milliseconds $RetryMs
  }
  return $false
}
if (-not (Test-HttpOk "http://127.0.0.1:8002/healthz" 45)) { throw "tax-engine not healthy after patch" }
Write-Host "tax-engine healthy after patch." -ForegroundColor Green
