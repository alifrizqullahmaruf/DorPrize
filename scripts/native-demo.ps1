param([ValidateSet('start', 'status', 'stop')][string]$Action = 'status')

$ErrorActionPreference = 'Stop'
$repoDirectory = Split-Path -Parent $PSScriptRoot
$backendDirectory = Join-Path $repoDirectory 'backend'
$runtimeFile = Join-Path $backendDirectory '.env.native-runtime.json'
$cloudflaredFile = Join-Path (Split-Path -Parent $repoDirectory) 'tmp/cloudflared/cloudflared.exe'
$tunnelLog = Join-Path $backendDirectory '.env.native-tunnel.stderr.log'

function Read-Runtime {
    if (Test-Path -LiteralPath $runtimeFile) { return Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json }
    return $null
}

function Get-ManagedProcess($ProcessId, $ExpectedPath, $ExpectedStartUtc) {
    if (-not $ProcessId -or -not $ExpectedPath -or -not $ExpectedStartUtc) { return $null }
    $candidateProcess = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $candidateProcess) { return $null }
    if ($candidateProcess.Path -ne $ExpectedPath -or $candidateProcess.StartTime.ToUniversalTime().ToString('o') -ne $ExpectedStartUtc) {
        throw 'PID belongs to a different process. Nothing was stopped.'
    }
    return $candidateProcess
}

$runtime = Read-Runtime
if ($Action -eq 'stop') {
    if (-not $runtime) { Write-Output 'No managed demo runtime is recorded.'; exit 0 }
    # Stop only between matches. Abrupt Windows process termination leaves
    # active matches to the already implemented expiry/refund recovery flow.
    $tunnelProcess = Get-ManagedProcess $runtime.tunnelPID $runtime.tunnelExecutable $runtime.tunnelStartedAt
    $backendProcess = Get-ManagedProcess $runtime.backendPID $runtime.backendExecutable $runtime.backendStartedAt
    if ($tunnelProcess) { Stop-Process -Id $tunnelProcess.Id }
    if ($backendProcess) { Stop-Process -Id $backendProcess.Id }
    if ($tunnelProcess -and -not $tunnelProcess.WaitForExit(5000)) { throw 'Tunnel shutdown timed out.' }
    if ($backendProcess -and -not $backendProcess.WaitForExit(5000)) { throw 'Backend shutdown timed out.' }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (-not (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue)) { break }
        Start-Sleep -Milliseconds 250
    }
    Write-Output 'Managed demo processes stopped. Stored keys and database records were retained.'
    exit 0
}

if ($Action -eq 'start') {
    if ($runtime -and (Get-ManagedProcess $runtime.backendPID $runtime.backendExecutable $runtime.backendStartedAt)) {
        throw 'A managed backend is already running. Use status, or stop it between matches before restarting.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $backendDirectory '.env'))) { throw 'Configure backend/.env first.' }
    if (-not (Test-Path -LiteralPath $cloudflaredFile)) { throw 'Official cloudflared.exe is required in MONAD/tmp/cloudflared/.' }
    if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 3001 is already in use. No process was replaced.' }
    $nodeExecutable = (Get-Command node).Source
    $backendProcess = Start-Process -FilePath $nodeExecutable -ArgumentList @('--env-file=.env', '--import', 'tsx', 'src/index.ts') -WorkingDirectory $backendDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $backendDirectory '.env.native-backend.stdout.log') -RedirectStandardError (Join-Path $backendDirectory '.env.native-backend.stderr.log')
    $runtime = [ordered]@{ backendPID = $backendProcess.Id; backendExecutable = $backendProcess.Path; backendStartedAt = $backendProcess.StartTime.ToUniversalTime().ToString('o'); port = 3001 }
    $runtime | ConvertTo-Json | Set-Content -LiteralPath $runtimeFile -Encoding UTF8
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try { $ready = [bool](Invoke-RestMethod -Uri 'http://127.0.0.1:3001/ready' -TimeoutSec 2).ok } catch { $ready = $false }
        if ($ready) { break }
        if ($backendProcess.HasExited) { throw 'Backend startup failed. Inspect local ignored runtime logs.' }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) { throw 'Backend readiness timed out. The recorded process can be stopped with this script.' }
    $tunnelProcess = Start-Process -FilePath $cloudflaredFile -ArgumentList @('tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:3001') -WorkingDirectory $backendDirectory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $backendDirectory '.env.native-tunnel.stdout.log') -RedirectStandardError $tunnelLog
    $runtime.tunnelPID = $tunnelProcess.Id
    $runtime.tunnelExecutable = $tunnelProcess.Path
    $runtime.tunnelStartedAt = $tunnelProcess.StartTime.ToUniversalTime().ToString('o')
    $runtime | ConvertTo-Json | Set-Content -LiteralPath $runtimeFile -Encoding UTF8
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        if (Test-Path -LiteralPath $tunnelLog) {
            $urlMatch = [regex]::Match([string](Get-Content -LiteralPath $tunnelLog -Raw), 'https://[a-z0-9-]+\.trycloudflare\.com')
            if ($urlMatch.Success) { $runtime.backendURL = $urlMatch.Value; break }
        }
        if ($tunnelProcess.HasExited) { throw 'Tunnel startup failed. Inspect local ignored tunnel logs.' }
        Start-Sleep -Milliseconds 500
    }
    $runtime | ConvertTo-Json | Set-Content -LiteralPath $runtimeFile -Encoding UTF8
    if (-not $runtime.backendURL) { throw 'Tunnel URL was not ready. Processes are recorded; use status or stop.' }
}

$runtime = Read-Runtime
$localReady = $false
try { $localReady = [bool](Invoke-RestMethod -Uri 'http://127.0.0.1:3001/ready' -TimeoutSec 5).ok } catch { }
[PSCustomObject]@{ LocalReady = $localReady; BackendURL = $runtime.backendURL; BackendPID = $runtime.backendPID; TunnelPID = $runtime.tunnelPID }
if ($runtime.backendURL) { Write-Output ('NEXT_PUBLIC_BACKEND_API_URL=' + $runtime.backendURL) }
