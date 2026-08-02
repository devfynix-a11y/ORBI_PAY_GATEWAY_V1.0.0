param(
  [string]$CoreRepoPath = "D:\FYNIX\ORBI\ORBI CORE\ORBI-Insitutional-Core-V2.0.4-Preview Stable",
  [string]$GatewayImage = "orbi-pay-gateway:local",
  [string]$GatewayBaseUrl = "http://127.0.0.1:3101",
  [string]$CoreHealthUrl = "http://127.0.0.1:3001/health",
  [string]$EvidencePath = ".release-gate\pay-gateway-release-gate.json",
  [switch]$InstallDependencies,
  [switch]$SkipBuild,
  [switch]$SkipSdkChecks,
  [switch]$SkipDocsChecks,
  [switch]$SkipRuntimeSmoke,
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
Set-Location $gatewayRoot

function Resolve-OrbiCoreSmokeScript([string]$RequestedCoreRepoPath, [string]$GatewayRoot) {
  $candidateRoots = @()
  if ($RequestedCoreRepoPath) {
    $candidateRoots += $RequestedCoreRepoPath
  }
  $candidateRoots += @(
    "D:\FYNIX\ORBI\Orbi Infrastructures\ORBI CORE\Core Backend\ORBI-Insitutional-Core-V2.0.4-Preview Stable",
    "D:\FYNIX\ORBI\Orbi Infrastructures\ORBI CORE\Core Backend",
    "D:\FYNIX\ORBI\Orbi Infrastructures\ORBI CORE",
    (Join-Path $GatewayRoot "..\..\ORBI CORE\Core Backend"),
    (Join-Path $GatewayRoot "..\..\ORBI CORE")
  )

  foreach ($candidate in $candidateRoots) {
    if (-not $candidate) {
      continue
    }
    $resolvedCandidate = $null
    try {
      $resolvedCandidate = (Resolve-Path $candidate -ErrorAction Stop).Path
    } catch {
      continue
    }

    $directSmokeScript = Join-Path $resolvedCandidate "ops\self-hosted\scripts\test-sandbox-pay-gateway.ps1"
    if (Test-Path -LiteralPath $directSmokeScript) {
      return [ordered]@{
        coreRoot = $resolvedCandidate
        smokeScript = $directSmokeScript
      }
    }

    $foundSmokeScript = Get-ChildItem -LiteralPath $resolvedCandidate -Recurse -Filter "test-sandbox-pay-gateway.ps1" -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if ($foundSmokeScript) {
      $coreRoot = $foundSmokeScript.FullName -replace "\\ops\\self-hosted\\scripts\\test-sandbox-pay-gateway\.ps1$", ""
      return [ordered]@{
        coreRoot = $coreRoot
        smokeScript = $foundSmokeScript.FullName
      }
    }
  }

  throw "Unable to locate test-sandbox-pay-gateway.ps1. Pass -CoreRepoPath to the current ORBI Core checkout or restore the sandbox smoke script."
}

$coreSmoke = Resolve-OrbiCoreSmokeScript -RequestedCoreRepoPath $CoreRepoPath -GatewayRoot $gatewayRoot
$coreRoot = $coreSmoke.coreRoot
$resolvedSandboxSmokeScript = $coreSmoke.smokeScript

Assert-Command "npm"
Assert-Command "docker"
Assert-Command "node"

if ($InstallDependencies) {
  Invoke-OrbiCommand "Installing Pay Gateway dependencies" "npm" @("ci")
  Invoke-OrbiCommand "Installing Node SDK dependencies" "npm" @("--prefix", "sdk/node", "ci")
}

if (-not $SkipSdkChecks) {
  Invoke-OrbiCommand "Checking SDK release metadata" "npm" @("run", "sdk:metadata:check")
  Invoke-OrbiCommand "Checking Node SDK" "npm" @("run", "sdk:node:check")
  Invoke-OrbiCommand "Checking Python SDK" "npm" @("run", "sdk:python:check")
  if (Get-Command php -ErrorAction SilentlyContinue) {
    Invoke-OrbiCommand "Checking PHP SDK" "npm" @("run", "sdk:php:check")
  } else {
    Write-Warning "PHP was not found in PATH. PHP SDK syntax check skipped by runtime availability."
  }
  Invoke-OrbiCommand "Dry-run Node SDK package" "npm" @("run", "sdk:node:pack")
}

if (-not $SkipDocsChecks) {
  Invoke-OrbiCommand "Checking OpenAPI contract" "npm" @("run", "openapi:check")
  Invoke-OrbiCommand "Checking developer docs and SDK catalog" "tsx" @("--test", "--test-force-exit", "tests/developerResourceCatalog.test.ts")
}

if (-not $SkipBuild) {
  Invoke-OrbiCommand "Building Pay Gateway" "npm" @("run", "build")
  Invoke-OrbiCommand "Building Pay Gateway Docker image $GatewayImage" "docker" @("build", "-t", $GatewayImage, ".")
}

if (-not $SkipSandboxGate) {
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
    "-File", $resolvedSandboxSmokeScript
  ) + $smokeArgs

  Invoke-OrbiCommand "Running Pay Gateway sandbox smoke gate" "powershell" $powershellArgs
}

if (-not $SkipRuntimeSmoke) {
  $previousSmokeBaseUrl = $env:PAYMENT_GATEWAY_SMOKE_BASE_URL
  try {
    $env:PAYMENT_GATEWAY_SMOKE_BASE_URL = $GatewayBaseUrl
    Invoke-OrbiCommand "Running runtime controls smoke" "npm" @("run", "smoke:runtime-controls")
  } finally {
    $env:PAYMENT_GATEWAY_SMOKE_BASE_URL = $previousSmokeBaseUrl
  }
}

$commitSha = (& git rev-parse HEAD).Trim()
$evidenceFullPath = [System.IO.Path]::GetFullPath((Join-Path $gatewayRoot $EvidencePath))
$evidenceDirectory = Split-Path -Parent $evidenceFullPath
if (-not (Test-Path $evidenceDirectory)) {
  New-Item -ItemType Directory -Path $evidenceDirectory -Force | Out-Null
}

[ordered]@{
  service = "orbi-pay-gateway"
  commitSha = $commitSha
  generatedAtUtc = [datetime]::UtcNow.ToString("o")
  gatewayImage = $GatewayImage
  coreRepoPath = $CoreRepoPath
  resolvedCoreRepoPath = $coreRoot
  sandboxSmokeScript = $resolvedSandboxSmokeScript
  gatewayBaseUrl = $GatewayBaseUrl
  sdkChecksSkipped = [bool]$SkipSdkChecks
  docsChecksSkipped = [bool]$SkipDocsChecks
  runtimeSmokeSkipped = [bool]$SkipRuntimeSmoke
  sandboxGateSkipped = [bool]$SkipSandboxGate
  negativeTestsSkipped = [bool]$SkipNegativeTests
  releaseChecks = [ordered]@{
    sdkReleaseSync = -not [bool]$SkipSdkChecks
    developerDocsAndOpenApi = -not [bool]$SkipDocsChecks
    runtimeControlsSmoke = -not [bool]$SkipRuntimeSmoke
    sandboxCertification = -not [bool]$SkipSandboxGate
    operatorEvidenceWritten = $true
  }
} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $evidenceFullPath -Encoding ASCII

Write-Output "Release gate evidence written to $evidenceFullPath"
Write-Output "PAY_GATEWAY_RELEASE_GATE_PASS"
