Param(
    [switch]$Watch
)

$cmd = "pnpm provider:contracts"
if ($Watch) {
    $cmd = "$cmd --watch"
}

Write-Host "Executing provider contracts: $cmd"
& cmd /c $cmd
if ($LASTEXITCODE -ne 0) {
    throw "Provider contract suite failed with exit code $LASTEXITCODE"
}
