import type { RunIssueSummary } from '../email/issue-summary.ts';

export interface IssueEmailClient {
  sendSummary(summary: RunIssueSummary): Promise<void>;
}
