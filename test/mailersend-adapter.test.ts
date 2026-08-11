import assert from 'node:assert/strict';
import test from 'node:test';
import { MailerSendIssueEmailClient } from '../src/adapters/mailersend.ts';
import type { RunIssueSummary } from '../src/email/issue-summary.ts';
import type { EmailParams } from 'mailersend';

const summary: RunIssueSummary = {
  timestamp: '2026-08-04T12:00:00.000Z',
  mappingsAttempted: 1,
  outcomes: [{ kind: 'skipped', groupId: 'missing', reason: 'group-not-found' }],
  issues: [{
    kind: 'group-skipped',
    groupId: 'missing',
    groupEmail: 'missing@example.com',
    reason: 'group-not-found'
  }]
};

test('MailerSend adapter maps validated config to one plain-text message without network access', async () => {
  let receivedApiKey: string | undefined;
  const receivedParams: EmailParams[] = [];
  const client = new MailerSendIssueEmailClient(
    {
      apiKey: 'synthetic-api-key',
      fromEmail: 'sender@example.com',
      fromName: 'DDS',
      toEmails: ['ops@example.com', 'admin@example.com']
    },
    (apiKey) => {
      receivedApiKey = apiKey;
      return {
        email: {
          async send(params) {
            receivedParams.push(params);
            return { statusCode: 202 };
          }
        }
      };
    }
  );

  await client.sendSummary(summary);

  assert.equal(receivedApiKey, 'synthetic-api-key');
  assert.equal(receivedParams.length, 2);
  assert.equal(receivedParams[0]?.from?.email, 'sender@example.com');
  assert.equal(receivedParams[0]?.from?.name, 'DDS');
  assert.deepEqual(receivedParams.map((params) => params.to.map((recipient) => recipient.email)), [
    ['ops@example.com'],
    ['admin@example.com']
  ]);
  assert.ok(receivedParams.every((params) => /warning/.test(params.subject ?? '')));
  assert.ok(receivedParams.every((params) => /missing@example.com/.test(params.text ?? '')));
  assert.ok(receivedParams.every((params) => params.html === undefined));
});

test('MailerSend adapter waits for each recipient before sending the next message', async () => {
  const events: string[] = [];
  let releaseFirst: (() => void) | undefined;
  let sendCount = 0;
  const client = new MailerSendIssueEmailClient(
    {
      apiKey: 'synthetic-api-key',
      fromEmail: 'sender@example.com',
      toEmails: ['ops@example.com', 'admin@example.com']
    },
    () => ({
      email: {
        send(params) {
          const recipient = params.to[0]?.email;
          events.push(`start:${recipient}`);
          sendCount += 1;
          if (sendCount === 1) {
            return new Promise<void>((resolve) => {
              releaseFirst = () => {
                events.push('complete:ops@example.com');
                resolve();
              };
            });
          }
          events.push(`complete:${recipient}`);
          return Promise.resolve();
        }
      }
    })
  );

  const sending = client.sendSummary(summary);
  await Promise.resolve();
  assert.deepEqual(events, ['start:ops@example.com']);

  releaseFirst?.();
  await sending;
  assert.deepEqual(events, [
    'start:ops@example.com',
    'complete:ops@example.com',
    'start:admin@example.com',
    'complete:admin@example.com'
  ]);
});

test('MailerSend adapter attempts later recipients when an earlier send fails', async () => {
  const recipients: string[] = [];
  const expectedError = new Error('first recipient failed');
  let sendCount = 0;
  const client = new MailerSendIssueEmailClient(
    {
      apiKey: 'synthetic-api-key',
      fromEmail: 'sender@example.com',
      toEmails: ['ops@example.com', 'admin@example.com']
    },
    () => ({
      email: {
        async send(params) {
          recipients.push(params.to[0]?.email ?? '');
          sendCount += 1;
          if (sendCount === 1) {
            throw expectedError;
          }
          return { statusCode: 202 };
        }
      }
    })
  );

  await assert.rejects(client.sendSummary(summary), (error) => error === expectedError);
  assert.deepEqual(recipients, ['ops@example.com', 'admin@example.com']);
});
