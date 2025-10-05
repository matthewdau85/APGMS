param(
    [string]$EnvFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env'),
    [string]$HealthCheckUrl = 'http://localhost:8000/health/capabilities'
)

function Update-EnvFile {
    param(
        [string]$Path,
        [hashtable]$Updates
    )

    $existing = @()
    if (Test-Path $Path) {
        $existing = Get-Content -Path $Path -Encoding UTF8
    }

    $output = @()
    foreach ($line in $existing) {
        $trimmed = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith('#')) {
            $output += $line
            continue
        }

        $parts = $line.Split('=', 2)
        if ($parts.Length -eq 2 -and $Updates.ContainsKey($parts[0])) {
            continue
        }

        $output += $line
    }

    foreach ($key in $Updates.Keys) {
        $output += "$key=$($Updates[$key])"
    }

    $output | Set-Content -Path $Path -Encoding UTF8
    Write-Host "Updated $Path"
}

try {
    Invoke-WebRequest -Uri $HealthCheckUrl -UseBasicParsing | Out-Null
} catch {
    Write-Error "Health check failed at $HealthCheckUrl. Aborting profile switch."
    exit 1
}

$updates = @{
    APP_PROFILE      = 'prod'
    PROVIDERS        = 'bank=real;kms=real;rates=real;idp=prod;statements=real'
    SHADOW_MODE      = 'false'
    PROTO_KILL_SWITCH = 'false'
}

Update-EnvFile -Path $EnvFile -Updates $updates
