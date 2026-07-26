param(
  [switch]$NodeOnly,
  [switch]$PythonOnly,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$PSNativeCommandUseErrorActionPreference = $true

function Invoke-Checked($File, [string[]]$Arguments) {
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $File $($Arguments -join ' ')"
  }
}

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' is not installed or not available in PATH."
  }
}

function Require-Env($Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Missing required environment variable $Name."
  }
  return $value
}

$root = Split-Path -Parent $PSScriptRoot

if (-not $PythonOnly) {
  Require-Command npm
  $npmToken = $null
  if (-not $DryRun) {
    $npmToken = Require-Env "NPM_TOKEN"
  }
  Push-Location (Join-Path $root "sdk/node")
  try {
    Invoke-Checked npm @("run", "check")
    if ($DryRun) {
      Invoke-Checked npm @("pack", "--dry-run")
    } else {
      "//registry.npmjs.org/:_authToken=$npmToken" | Set-Content -NoNewline ".npmrc"
      Invoke-Checked npm @("publish", "--access", "public")
    }
  } finally {
    if (Test-Path ".npmrc") {
      Remove-Item ".npmrc" -Force
    }
    Pop-Location
  }
}

if (-not $NodeOnly) {
  Require-Command python
  $pypiToken = $null
  if (-not $DryRun) {
    $pypiToken = Require-Env "PYPI_API_TOKEN"
  }
  Push-Location (Join-Path $root "sdk/python")
  try {
    Invoke-Checked python @("-m", "unittest", "discover", "-s", "tests")
    Invoke-Checked python @("-m", "pip", "install", "--upgrade", "build", "twine")
    if ($DryRun) {
      Invoke-Checked python @("-m", "build", "--sdist", "--wheel")
      Invoke-Checked python @("-m", "twine", "check", "dist/*")
    } else {
      if (Test-Path "dist") {
        Remove-Item "dist" -Recurse -Force
      }
      Invoke-Checked python @("-m", "build", "--sdist", "--wheel")
      Invoke-Checked python @("-m", "twine", "upload", "-u", "__token__", "-p", $pypiToken, "dist/*")
    }
  } finally {
    Pop-Location
  }
}

Write-Host "ORBI SDK release command completed."
