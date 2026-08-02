# ORBI Pay SDK Release Runbook

This runbook publishes official ORBI Pay Gateway SDKs after code review and
registry credentials are ready.

## Packages

| Language | Package | Source | Status |
| --- | --- | --- | --- |
| Node.js / TypeScript | `@orbifinancial/pay-gateway` | `sdk/node` | Live on npm, test-covered |
| Python | `orbi-pay-gateway` | `sdk/python` | Live on PyPI, test-covered |
| PHP | `orbifinancial/pay-gateway` | `sdk/php` | Live on Packagist, Composer-ready |

## Release-Only Credentials

These are package registry publishing credentials only. They are not Gateway,
Developer Portal, sandbox, live, Docker, or Vercel project variables.

Set them only in the temporary SDK release shell or in a locked CI release
secret store:

```env
NPM_TOKEN=...
PYPI_API_TOKEN=...
```

PHP packages are normally published by pushing the tagged Git repository and
linking it to Packagist. Do not store Composer credentials in source control.

Node install is live:

```bash
npm i @orbifinancial/pay-gateway
```

Python install is live:

```bash
pip install orbi-pay-gateway
```

PHP install is live:

```bash
composer require orbifinancial/pay-gateway
```

## PHP Packagist Release

Packagist expects `composer.json` at the repository root. Because this Gateway
is a monorepo and the PHP SDK lives in `sdk/php`, publish PHP through a small
split repository such as:

```text
adminorbi-gif/orbi-pay-gateway-php-sdk
```

The split repository root must contain:

```text
composer.json
README.md
src/
```

Release flow:

```powershell
cd "D:\FYNIX\ORBI\ORBI CORE\ORBI PAY GATEWAY"
git subtree split --prefix=sdk/php -b release/php-sdk
git push git@github.com:adminorbi-gif/orbi-pay-gateway-php-sdk.git release/php-sdk:main
git tag php-sdk-v0.1.0 release/php-sdk
git push git@github.com:adminorbi-gif/orbi-pay-gateway-php-sdk.git php-sdk-v0.1.0
```

Then open Packagist and submit the split repository URL. After Packagist indexes
it, verify:

```bash
composer require orbifinancial/pay-gateway
```

If PHP and Composer are available locally, validate before tagging:

```powershell
cd sdk/php
composer validate --strict
Get-ChildItem src -Filter *.php | ForEach-Object { php -l $_.FullName }
```

## Preflight

```powershell
npm run sdk:check
npm run sdk:node:pack
npm run openapi:check
```

`npm run sdk:check` verifies:

- SDK package names and versions are aligned.
- Node SDK builds and tests.
- Python SDK tests.
- PHP Composer metadata and PHP syntax when PHP is installed.
- Developer docs mention Node, Python, and PHP installation commands.

Full release gate:

```powershell
npm run release:gate
```

The gate checks SDKs, OpenAPI/docs catalog, gateway build, runtime controls,
sandbox certification flow, and writes local evidence under `.release-gate/`.

## Publish

Dry-run packaging:

```powershell
npm run sdk:publish -- -DryRun
```

Publish Node and Python:

```powershell
# Release shell only. Do not add these to project runtime env files.
$env:NPM_TOKEN="npm_..."
$env:PYPI_API_TOKEN="pypi-..."
npm run sdk:publish
```

Publish one package only:

```powershell
npm run sdk:publish -- -NodeOnly
npm run sdk:publish -- -PythonOnly
```

## After Publish

1. Verify install from a clean project.
2. Confirm sandbox payment intent creation with `Demo` keys.
3. Confirm webhook verification rejects invalid signatures.
4. Tag the release in Git.
5. Update Developer Portal SDK catalog with the published versions.
6. Update [SDK Changelog](./SDK_CHANGELOG.md) with developer-facing changes.

## Operator Release Checklist

Before a live release, the operator must confirm:

- `npm run release:gate` passed or the skipped gate is documented as an
  emergency diagnostic.
- `.release-gate/pay-gateway-release-gate.json` contains the expected commit SHA.
- Developer Portal shows healthy Security Command controls or every warning has
  an assigned owner.
- SDK package versions match the Developer Portal SDK catalog.
- Webhook replay and idempotency examples are still SDK-first.
- No registry token, API key, webhook secret, OAuth secret, or service credential
  was printed into docs, logs, screenshots, or Git.

Never publish SDKs from a machine where production service keys are printed in
terminal history. Registry tokens must be rotated if accidentally exposed.
