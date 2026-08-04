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
  let receivedParams: EmailParams | undefined;
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
            receivedParams = params;
            return { statusCode: 202 };
          }
        }
      };
    }
  );

  await client.sendSummary(summary);

  assert.equal(receivedApiKey, 'synthetic-api-key');
  assert.equal(receivedParams?.from?.email, 'sender@example.com');
  assert.equal(receivedParams?.from?.name, 'DDS');
  assert.deepEqual(receivedParams?.to.map((recipient) => recipient.email), [
    'ops@example.com',
    'admin@example.com'
  ]);
  assert.match(receivedParams?.subject ?? '', /warning/);
  assert.match(receivedParams?.text ?? '', /missing@example.com/);
  assert.equal(receivedParams?.html, undefined);
});
