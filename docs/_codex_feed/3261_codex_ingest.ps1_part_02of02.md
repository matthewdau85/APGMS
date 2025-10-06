# File: codex_ingest.ps1 (part 2 of 2)
```powershell

Write-Host "Done. Output: $OutDir"
Write-Host "Total parts: $($manifest.Count)"
'@ | Set-Content -LiteralPath .\codex_ingest_fixed.ps1 -Encoding UTF8

```

