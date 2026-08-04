import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.ts';

function environment(groupMap: string): NodeJS.ProcessEnv {
  return {
    CLIENTEMAIL: 'service@example.com',
    PRIVATEKEY: '-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----',
    GOOGLEUSER: 'admin@example.com',
    ODOOURL: 'https://odoo.example.com',
    ODOODB: 'database',
    ODOOUSER: 'user',
    ODOOPASSWORD: 'password',
    GROUPMAP: groupMap
  };
}

test('parses and defaults a valid legacy GROUPMAP', () => {
  const config = loadConfig(environment('[[[1, 2], "group", true]]'));
  assert.deepEqual(config.groupMap, [{ odooIds: [1, 2], groupId: 'group', excludeParents: true }]);
  assert.equal(config.google.groupDomain, 'valhallagruppe.dk');
  assert.equal(config.odoo.organizationId, 859);
});

test('rejects malformed GROUPMAP entries as a whole configuration', () => {
  assert.throws(
    () => loadConfig(environment('[[1, "valid"], ["not-an-id", "invalid"]]')),
    /GROUPMAP entry 1 odooIds/
  );
});

test('rejects malformed private keys before any API client is constructed', () => {
  const env = environment('[[1, "group"]]');
  env.PRIVATEKEY = 'private-key';
  assert.throws(() => loadConfig(env), /PRIVATEKEY must contain/);
});

test('fails before use when required credentials are missing', () => {
  const env = environment('[[1, "group"]]');
  delete env.ODOOPASSWORD;
  assert.throws(() => loadConfig(env), /ODOOPASSWORD/);
});
