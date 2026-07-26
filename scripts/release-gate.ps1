param(
  [string]$CoreRepoPath = "D:\FYNIX\ORBI\ORBI CORE\ORBI-Insitutional-Core-V2.0.4-Preview Stable",
  [string]$GatewayImage = "orbi-pay-gateway:local",
  [string]$GatewayBaseUrl = "http://127.0.0.1:3101",
  [string]$CoreHealthUrl = "http://127.0.0.1:3001/health",
  [switch]$InstallDependencies,
  [switch]$SkipBuild,
  [switch]$SkipSdkChecks,
  [switch]$SkipSandboxGate,
  [switch]$SkipNegativeTests
)

$ErrorActionPreference = "Stop"

function Assert-Command([string]$Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found in PATH."
  }
}

function Invoke-OrbiCommand([string]$Label, [string]$File, [string[]]$Arguments = @()) {
  Write-Output "==> $Label"
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE."
  }
}

$gatewayRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$coreRoot = (Resolve-Path $CoreRepoPath).Path
Set-Location $gatewayRoot

Assert-Command "npm"
Assert-Command "docker"
Assert-Command "node"

if ($InstallDependencies) {
  Invoke-OrbiCommand "Installing Pay Gateway dependencies" "npm" @("ci")
  Invoke-OrbiCommand "Installing Node SDK dependencies" "npm" @("--prefix", "sdk/node", "ci")
}

if (-not $SkipSdkChecks) {
  Invoke-OrbiCommand "Checking Node SDK" "npm" @("run", "sdk:node:check")
}

if (-not $SkipBuild) {
  Invoke-OrbiCommand "Building Pay Gateway" "npm" @("run", "build")
  Invoke-OrbiCommand "Building Pay Gateway Docker image $GatewayImage" "docker" @("build", "-t", $GatewayImage, ".")
}

if (-not $SkipSandboxGate) {
  $smokeScript = Join-Path $coreRoot "ops\self-hosted\scripts\test-sandbox-pay-gateway.ps1"
  $smokeArgs = @(
    "-GatewayRepoPath", $gatewayRoot,
    "-GatewayBaseUrl", $GatewayBaseUrl,
    "-CoreHealthUrl", $CoreHealthUrl,
    "-EnsureContainers",
    "-SeedFixtures",
    "-RotateSecrets"
  )
  if ($SkipNegativeTests) {
    $smokeArgs += "-SkipNegativeTests"
  }

  $powershellArgs = @(
    "-ExecutionPolicy", "Bypass",
    "-File", $smokeScript
  ) + $smokeArgs

  Invoke-OrbiCommand "Running Pay Gateway sandbox smoke gate" "powershell" $powershellArgs
}

Write-Output "PAY_GATEWAY_RELEASE_GATE_PASS"
