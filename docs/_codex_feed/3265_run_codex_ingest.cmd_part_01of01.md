# File: run_codex_ingest.cmd (part 1 of 1)
```batch
@echo off
REM run_codex_ingest.cmd
REM Helper to run codex_ingest.ps1 with safe defaults.
SETLOCAL ENABLEDELAYEDEXPANSION

IF "%~1"=="" (
  echo Usage: run_codex_ingest.cmd ^<RootFolder^> [ChunkChars]
  echo Example: run_codex_ingest.cmd "C:\src\apgms" 14000
  EXIT /B 1
)
SET ROOT=%~1
SET CHUNK=%~2
IF "%CHUNK%"=="" SET CHUNK=12000

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0codex_ingest.ps1" -Root "%ROOT%" -ChunkChars %CHUNK% -MakeCombined

IF ERRORLEVEL 1 (
  echo Failed. Check your parameters and try again.
  EXIT /B 1
)
echo Done.

```

