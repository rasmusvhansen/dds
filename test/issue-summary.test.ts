import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatIssueBody,
  formatIssueSubject,
  getIssueCounts,
  getRunStatus,
  MAX_SUMMARY_BODY_LENGTH,
  type RunIssueSummary
} from '../src/email/issue-summary.ts';
import { normalizeEmail } from '../src/domain/member.ts';

const warningSummary: RunIssueSummary = {
  timestamp: '2026-08-04T12:00:00.000Z',
  mappingsAttempted: 3,
  outcomes: [
    { kind: 'synchronized', groupId: 'ok', added: 1, deleted: 2 },
    { kind: 'skipped', groupId: 'missing', reason: 'group-not-found' }
  ],
  issues: [
    {
      kind: 'group-skipped',
      groupId: 'missing',
      groupEmail: 'missing@valhallagruppe.dk',
      reason: 'group-not-found'
    }
  ]
};

test('healthy summaries do not require notification', () => {
  const summary: RunIssueSummary = {
    timestamp: '2026-08-04T12:00:00.000Z',
    mappingsAttempted: 1,
    outcomes: [{ kind: 'synchronized', groupId: 'ok', added: 0, deleted: 0 }],
    issues: []
  };
  assert.equal(getRunStatus(summary), 'success');
  assert.equal(getIssueCounts(summary).totalIssues, 0);
});

test('warning summaries include skipped groups and zero failed groups', () => {
  assert.equal(getRunStatus(warningSummary), 'warning');
  assert.equal(getIssueCounts(warningSummary).failedGroups, 0);
  assert.match(formatIssueSubject(warningSummary), /warning/);
  assert.match(formatIssueBody(warningSummary), /missing@valhallagruppe.dk/);
});

test('error summaries include failed member operations and normalized emails', () => {
  const summary: RunIssueSummary = {
    ...warningSummary,
    issues: [
      {
        kind: 'member-operation-failed',
        groupId: 'broken',
        groupEmail: 'broken@valhallagruppe.dk',
        operation: 'add',
        emails: [normalizeEmail(' Person@Example.com ')],
        message: 'add operation failed for 1 member'
      }
    ],
    outcomes: [...warningSummary.outcomes, { kind: 'failed', groupId: 'broken', error: 'ignored' }]
  };
  assert.equal(getRunStatus(summary), 'error');
  assert.equal(getIssueCounts(summary).failedAdds, 1);
  const body = formatIssueBody(summary);
  assert.match(body, /broken@valhallagruppe.dk \(add\): person@example.com/);
  assert.doesNotMatch(body, /private-key|api-key|password/i);
});

test('failed-group messages redact credential-like details', () => {
  const summary: RunIssueSummary = {
    ...warningSummary,
    outcomes: [{ kind: 'failed', groupId: 'broken', error: 'ignored' }],
    issues: [{
      kind: 'group-failed',
      groupId: 'broken',
      groupEmail: 'broken@valhallagruppe.dk',
      message: 'request failed: {"apiKey":"secret-value","client_secret":"client-secret-value","privateKeyId":"private-id"} https://example.test/send?access_token=url-secret'
    }]
  };
  const body = formatIssueBody(summary);
  assert.match(body, /DETAILS REDACTED/);
  assert.doesNotMatch(body, /secret-value|client-secret-value|private-id|url-secret/);
  assert.doesNotMatch(body, /request failed: \{/);
});

test('large summaries are truncated with an explicit marker', () => {
  const summary: RunIssueSummary = {
    ...warningSummary,
    issues: Array.from({ length: 5_000 }, (_, index) => ({
      kind: 'group-failed' as const,
      groupId: `group-${index}`,
      groupEmail: `group-${index}@example.com`,
      message: 'failure'
    }))
  };
  const body = formatIssueBody(summary);
  assert.equal(body.length, MAX_SUMMARY_BODY_LENGTH);
  assert.match(body, /Additional issue details omitted/);
});
