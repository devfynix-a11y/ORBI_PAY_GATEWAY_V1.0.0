import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireMatch(name, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${name} mismatch. Expected "${expected}", received "${actual}".`);
  }
}

function requireIncludes(file, text, needle) {
  if (!text.includes(needle)) {
    throw new Error(`${file} is missing required developer instruction: ${needle}`);
  }
}

function extractTomlString(text, key) {
  const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'));
  return match?.[1] ?? null;
}

const nodePackage = readJson('sdk/node/package.json');
const phpComposer = readJson('sdk/php/composer.json');
const pythonProject = readText('sdk/python/pyproject.toml');

requireMatch('Node SDK package name', nodePackage.name, '@orbifinancial/pay-gateway');
requireMatch('Python SDK package name', extractTomlString(pythonProject, 'name'), 'orbi-pay-gateway');
requireMatch('Python SDK version', extractTomlString(pythonProject, 'version'), nodePackage.version);
requireMatch('PHP SDK package name', phpComposer.name, 'orbifinancial/pay-gateway');

const docsToCheck = [
  'docs/DEVELOPER_CONFIGURATION_GUIDE.md',
  'docs/LANGUAGE_INTEGRATION_CONFIGS.md',
  'docs/SDK_RELEASE_RUNBOOK.md',
  'docs/API_REFERENCE.md',
];

for (const file of docsToCheck) {
  const text = readText(file);
  requireIncludes(file, text, 'npm i @orbifinancial/pay-gateway');
  requireIncludes(file, text, 'pip install orbi-pay-gateway');
  requireIncludes(file, text, 'composer require orbifinancial/pay-gateway');
}

console.log(`SDK release metadata OK for ${nodePackage.version}.`);
