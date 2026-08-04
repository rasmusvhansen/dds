import assert from 'node:assert/strict';
import test from 'node:test';
import { errorMessage } from '../src/runtime/errors.ts';

test('extracts safe status and provider message from MailerSend response failures', () => {
  const message = errorMessage({
    statusCode: 422,
    headers: { authorization: 'Bearer synthetic-token' },
    body: {
      message: 'The given data was invalid.',
      errors: { from: ['The sender is not verified.'] }
    }
  });

  assert.equal(message, 'Request failed with status 422: The given data was invalid.');
  assert.doesNotMatch(message, /synthetic-token|sender is not verified/i);
});

test('does not expose MailerSend response payloads when the provider omits a message', () => {
  const message = errorMessage({
    statusCode: 401,
    headers: { authorization: 'Bearer synthetic-token' },
    body: { apiKey: 'synthetic-api-key', errors: { detail: ['unauthorized'] } }
  });

  assert.equal(message, 'Request failed with status 401');
  assert.doesNotMatch(message, /synthetic-api-key|unauthorized|synthetic-token/);
});
