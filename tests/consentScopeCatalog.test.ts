import assert from 'node:assert/strict';
import test from 'node:test';
import { consentScopeCatalog, consentScopeSummary } from '../src/services/consentScopeCatalog.js';

test('consent scope catalog explains supported external access scopes', () => {
  const catalog = consentScopeCatalog();
  const scopes = catalog.map((entry) => entry.scope);

  assert.equal(scopes.includes('payments:create'), true);
  assert.equal(scopes.includes('escrow:create'), true);
  assert.equal(scopes.includes('balance:read'), true);
  assert.equal(scopes.includes('webhooks:receive'), true);
  assert.equal(catalog.every((entry) => entry.title.en && entry.title.sw), true);
  assert.equal(catalog.every((entry) => entry.description.en && entry.description.sw), true);
});

test('consent scope summary returns localized user-facing copy', () => {
  const summary = consentScopeSummary(['payments:create', 'balance:read'], 'sw');

  assert.equal(summary.length, 2);
  assert.match(summary[0].title, /malipo/i);
  assert.equal(summary.every((entry) => entry.requiresHostedChallenge), true);
});
