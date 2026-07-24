import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

type PostmanItem = {
  name: string;
  item?: PostmanItem[];
  request?: {
    method: string;
    url: string | { raw?: string };
  };
};

type PostmanCollection = {
  info: {
    name: string;
    schema: string;
  };
  item: PostmanItem[];
};

const collectionPath = join(process.cwd(), 'docs', 'postman', 'orbi-pay-gateway.postman_collection.json');
const collection = JSON.parse(readFileSync(collectionPath, 'utf8')) as PostmanCollection;

test('postman collection declares ORBI gateway metadata', () => {
  assert.equal(collection.info.name, 'ORBI Pay Gateway');
  assert.match(collection.info.schema, /collection\/v2\.1\.0/);
});

test('postman collection covers core developer sandbox flows', () => {
  const names = flattenItems(collection.item).map((item) => item.name);

  for (const required of [
    'Resolve Identity',
    'Link Payment Profile',
    'Create Checkout Payment Intent',
    'Open Hosted Challenge',
    'Submit Hosted Challenge Approval',
    'Create PaySafe Escrow',
    'List Consent Receipts',
    'Replay Webhook Delivery',
    'Integration Health',
    'Environment Profiles',
    'Live Environment Profile',
    'Sandbox Simulator Flow',
    'Sandbox Simulator State',
    'Reset Sandbox Simulator',
    'Sandbox Accounts',
    'Sandbox Transfer',
    'Sandbox Transfer Webhook Event',
    'GraphQL Schema Preview',
    'GraphQL Migration Plan',
    'Consent Scope Catalog',
    'Consent Status Check',
    'List Connected Consents',
    'Revoke Connected Consent',
  ]) {
    assert.equal(names.includes(required), true, `${required} missing`);
  }
});

test('postman collection keeps runtime and operator keys separated', () => {
  const developerFolder = collection.item.find((item) => item.name === 'Developer Control Plane');
  assert.equal(Boolean(developerFolder), true);
  assert.match(JSON.stringify(developerFolder), /x-orbi-pay-operator-key/);
  assert.doesNotMatch(JSON.stringify(developerFolder), /x-orbi-pay-service-key/);
});

const flattenItems = (items: PostmanItem[]): PostmanItem[] =>
  items.flatMap((item) => [item, ...(item.item ? flattenItems(item.item) : [])]);
