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
    GROUPMAP: groupMap,
    MAILERSEND_API_KEY: 'test-api-key',
    MAILERSEND_FROM_EMAIL: 'sender@example.com',
    MAILERSEND_FROM_NAME: 'DDS',
    MAILERSEND_TO_EMAILS: 'ops@example.com, admin@example.com, ops@example.com'
  };
}

test('parses and defaults a valid legacy GROUPMAP', () => {
  const config = loadConfig(environment('[[[1, 2], "group", true]]'));
  assert.deepEqual(config.groupMap, [{ odooIds: [1, 2], groupId: 'group', excludeParents: true }]);
  assert.equal(config.google.groupDomain, 'valhallagruppe.dk');
  assert.equal(config.odoo.organizationId, 859);
  assert.deepEqual(config.email.toEmails, ['ops@example.com', 'admin@example.com']);
  assert.equal(config.email.fromName, 'DDS');
});

test('rejects malformed GROUPMAP entries as a whole configuration', () => {
  assert.throws(
    () => loadConfig(environment('[[1, "valid"], ["not-an-id", "invalid"]]')),
    /GROUPMAP entry 1 odooIds/
  );
});

test('rejects malformed MailerSend recipients', () => {
  const env = environment('[[1, "group"]]');
  env.MAILERSEND_TO_EMAILS = 'ops@example.com,,admin@example.com';
  assert.throws(() => loadConfig(env), /must not contain blank recipients/);
});

test('rejects malformed sender and missing recipients', () => {
  const senderEnv = environment('[[1, "group"]]');
  senderEnv.MAILERSEND_FROM_EMAIL = 'not-an-email';
  assert.throws(() => loadConfig(senderEnv), /MAILERSEND_FROM_EMAIL/);

  const recipientEnv = environment('[[1, "group"]]');
  delete recipientEnv.MAILERSEND_TO_EMAILS;
  assert.throws(() => loadConfig(recipientEnv), /MAILERSEND_TO_EMAILS/);
});

test('rejects missing MailerSend configuration before synchronization', () => {
  const env = environment('[[1, "group"]]');
  delete env.MAILERSEND_API_KEY;
  assert.throws(() => loadConfig(env), /MAILERSEND_API_KEY/);
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
