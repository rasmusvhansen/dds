import assert from 'node:assert/strict';
import test from 'node:test';
import { GroupNotFoundError } from '../src/ports/directory-client.ts';
import { errorStatusCodes } from '../src/runtime/errors.ts';
import { normalizeEmail } from '../src/domain/member.ts';
import { GoogleDirectoryClient, isGoogleNotFoundError, parseGoogleMembers } from '../src/adapters/google-directory.ts';
import type { Logger } from '../src/ports/logger.ts';

function errorWithStatus(status: number): unknown {
  return { response: { data: { error: { code: status } } } };
}

test('classifies nested Google-style 404 responses', () => {
  assert.deepEqual(errorStatusCodes(errorWithStatus(404)), [404]);
  assert.equal(isGoogleNotFoundError(errorWithStatus(404)), true);
  assert.equal(new GroupNotFoundError('gone').kind, 'group-not-found');
});

test('maps and deduplicates Google member responses', () => {
  assert.deepEqual(parseGoogleMembers({ members: [{ email: ' A@example.com ' }, {}, { email: 'a@example.com' }] }), [
    'a@example.com'
  ]);
  assert.deepEqual(parseGoogleMembers({}), []);
});

test('normalizes member operation values at the typed boundary', () => {
  assert.equal(normalizeEmail(' Person@Example.com '), 'person@example.com');
});

test('initializes Google auth with the configured in-memory private key', () => {
  const config = {
    clientEmail: 'service@example.com',
    privateKey: '-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----',
    delegatedUser: 'admin@example.com',
    groupDomain: 'example.com'
  };
  const logger: Logger = { info() {}, warn() {}, error() {} };

  assert.doesNotThrow(() => new GoogleDirectoryClient(config, logger));
});

test('logs the normalized email when adding a member fails', async () => {
  const warnings: Readonly<Record<string, unknown>>[] = [];
  const logger: Logger = {
    info() {},
    warn(_message, details) {
      if (details) warnings.push(details);
    },
    error() {}
  };
  const client = new GoogleDirectoryClient(
    {
      clientEmail: 'service@example.com',
      privateKey: '-----BEGIN PRIVATE KEY-----\\nfake\\n-----END PRIVATE KEY-----',
      delegatedUser: 'admin@example.com',
      groupDomain: 'example.com'
    },
    logger
  );
  const internalClient = client as unknown as {
    request: (operation: (service: never) => Promise<unknown>) => Promise<unknown>;
  };
  internalClient.request = async () => {
    throw new Error('simulated insert failure');
  };

  await assert.rejects(() => client.addMembers('group@example.com', [normalizeEmail(' Person@Example.com ')]));
  assert.deepEqual(warnings, [
    {
      group: 'group@example.com',
      operation: 'add',
      email: 'person@example.com',
      memberIndex: 0
    }
  ]);
});
