param(
    [string]$EnvFile = (Join-Path (Split-Path $PSScriptRoot -Parent) '.env')
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

$updates = @{
    APP_PROFILE      = 'dev'
    PROVIDERS        = 'bank=mock;kms=mock;rates=mock;idp=dev;statements=mock'
    SHADOW_MODE      = 'false'
    PROTO_KILL_SWITCH = 'true'
}

Update-EnvFile -Path $EnvFile -Updates $updates
