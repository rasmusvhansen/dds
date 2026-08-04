import type { NormalizedEmail } from '../domain/member.ts';
import type { GroupOutcome } from '../domain/group.ts';
import { errorMessage } from '../runtime/errors.ts';

export type RunIssue =
  | {
      readonly kind: 'group-skipped';
      readonly groupId: string;
      readonly groupEmail: string;
      readonly reason: 'group-not-found';
    }
  | {
      readonly kind: 'group-failed';
      readonly groupId: string;
      readonly groupEmail: string;
      readonly message: string;
    }
  | {
      readonly kind: 'member-operation-failed';
      readonly groupId: string;
      readonly groupEmail: string;
      readonly operation: 'add' | 'delete';
      readonly emails: readonly NormalizedEmail[];
      readonly message?: string;
    };

export type RunStatus = 'success' | 'warning' | 'error';

export interface RunIssueSummary {
  readonly timestamp: string;
  readonly mappingsAttempted: number;
  readonly outcomes: readonly GroupOutcome[];
  readonly issues: readonly RunIssue[];
}

export interface IssueCounts {
  readonly synchronized: number;
  readonly skipped: number;
  readonly failedGroups: number;
  readonly failedAdds: number;
  readonly failedDeletes: number;
  readonly totalIssues: number;
}

export const MAX_SUMMARY_BODY_LENGTH = 100_000;

export function getRunStatus(summary: RunIssueSummary): RunStatus {
  if (summary.issues.some((issue) => issue.kind === 'group-failed' || issue.kind === 'member-operation-failed')) {
    return 'error';
  }
  return summary.issues.length > 0 ? 'warning' : 'success';
}

export function getIssueCounts(summary: RunIssueSummary): IssueCounts {
  let failedAdds = 0;
  let failedDeletes = 0;
  for (const issue of summary.issues) {
    if (issue.kind === 'member-operation-failed') {
      if (issue.operation === 'add') {
        failedAdds += issue.emails.length;
      } else {
        failedDeletes += issue.emails.length;
      }
    }
  }

  return {
    synchronized: summary.outcomes.filter((outcome) => outcome.kind === 'synchronized').length,
    skipped: summary.outcomes.filter((outcome) => outcome.kind === 'skipped').length,
    failedGroups: summary.outcomes.filter((outcome) => outcome.kind === 'failed').length,
    failedAdds,
    failedDeletes,
    totalIssues: summary.issues.length
  };
}

export function formatIssueSubject(summary: RunIssueSummary): string {
  const status = getRunStatus(summary);
  const counts = getIssueCounts(summary);
  const issueCount = `${counts.totalIssues} issue${counts.totalIssues === 1 ? '' : 's'}`;
  return `DDS synchronization ${status}: ${issueCount}, ${counts.skipped} skipped, ${counts.failedGroups} failed group${counts.failedGroups === 1 ? '' : 's'}`;
}

export function formatIssueBody(summary: RunIssueSummary): string {
  const status = getRunStatus(summary).toUpperCase();
  const counts = getIssueCounts(summary);
  const lines: string[] = [
    'DDS synchronization issue summary',
    `Timestamp: ${summary.timestamp}`,
    `Status: ${status}`,
    '',
    'Counts:',
    `- Mappings attempted: ${summary.mappingsAttempted}`,
    `- Synchronized groups: ${counts.synchronized}`,
    `- Skipped groups: ${counts.skipped}`,
    `- Failed groups: ${counts.failedGroups}`,
    `- Failed additions: ${counts.failedAdds}`,
    `- Failed deletions: ${counts.failedDeletes}`,
    `- Total issues: ${counts.totalIssues}`,
    ''
  ];

  appendSection(lines, 'Skipped groups', summary.issues.filter(isSkippedIssue), (issue) =>
    `- ${issue.groupEmail}: ${issue.reason}`
  );
  appendSection(lines, 'Failed groups', summary.issues.filter(isFailedGroupIssue), (issue) =>
    `- ${issue.groupEmail}: ${errorMessage(issue.message)}`
  );
  appendSection(lines, 'Failed member operations', summary.issues.filter(isMemberFailureIssue), (issue) =>
    `- ${issue.groupEmail} (${issue.operation}): ${issue.emails.join(', ')}${issue.message ? ` — ${errorMessage(issue.message)}` : ''}`
  );

  lines.push('', 'The synchronization run completed; this message reports warnings and errors encountered during the run.');
  return truncateBody(lines.join('\n'));
}

function appendSection<T extends RunIssue>(
  lines: string[],
  title: string,
  issues: readonly T[],
  format: (issue: T) => string
): void {
  if (issues.length === 0) {
    return;
  }
  lines.push(`${title}:`);
  for (const issue of issues) {
    lines.push(format(issue));
  }
  lines.push('');
}

function truncateBody(body: string): string {
  if (body.length <= MAX_SUMMARY_BODY_LENGTH) {
    return body;
  }
  const suffix = '\n\n[Additional issue details omitted because the summary exceeded the maximum size.]';
  return body.slice(0, MAX_SUMMARY_BODY_LENGTH - suffix.length) + suffix;
}

function isSkippedIssue(issue: RunIssue): issue is Extract<RunIssue, { readonly kind: 'group-skipped' }> {
  return issue.kind === 'group-skipped';
}

function isFailedGroupIssue(issue: RunIssue): issue is Extract<RunIssue, { readonly kind: 'group-failed' }> {
  return issue.kind === 'group-failed';
}

function isMemberFailureIssue(issue: RunIssue): issue is Extract<RunIssue, { readonly kind: 'member-operation-failed' }> {
  return issue.kind === 'member-operation-failed';
}
