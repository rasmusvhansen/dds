import type { DirectoryClient } from '../ports/directory-client.ts';
import type { Logger } from '../ports/logger.ts';
import type { OdooClient } from '../ports/odoo-client.ts';
import type { GroupMapping, GroupOutcome, RunSummary, SyncPlan } from './group.ts';
import type { Member, NormalizedEmail } from './member.ts';
import { normalizeEmail } from './member.ts';
import { errorMessage } from '../runtime/errors.ts';
import type { RunIssue } from '../email/issue-summary.ts';
import type { MemberOperationFailureError } from '../ports/member-operation-failure.ts';

export function normalizeEmails(emails: readonly string[]): readonly NormalizedEmail[] {
  const unique = new Set<NormalizedEmail>();
  for (const email of emails) {
    unique.add(normalizeEmail(email));
  }
  return [...unique];
}

export function planMembership(
  googleMembers: readonly string[],
  odooMembers: readonly Member[]
): SyncPlan {
  const google = new Set(normalizeEmails(googleMembers));
  const odoo = new Set(normalizeEmails(odooMembers.map((member) => member.email)));

  return {
    toCreate: [...odoo].filter((email) => !google.has(email)),
    toDelete: [...google].filter((email) => !odoo.has(email))
  };
}

export interface Synchronizer {
  run(mappings: readonly GroupMapping[]): Promise<RunSummary>;
}

export function createSynchronizer(
  directory: DirectoryClient,
  odoo: OdooClient,
  logger: Logger,
  groupDomain = 'valhallagruppe.dk'
): Synchronizer {
  return {
    async run(mappings) {
      const outcomes: GroupOutcome[] = [];
      const issues: RunIssue[] = [];

      for (const mapping of mappings) {
        const groupEmail = `${mapping.groupId}@${groupDomain}`;
        try {
          const googleMembers = await directory.getMembers(groupEmail);
          const odooMembers = await odoo.getMembers(mapping.odooIds, mapping.excludeParents);
          const plan = planMembership(googleMembers, odooMembers);

          logger.info('Computed synchronization plan', {
            group: mapping.groupId,
            toCreate: plan.toCreate.length,
            toDelete: plan.toDelete.length
          });

          if (plan.toCreate.length > 0) {
            try {
              await directory.addMembers(groupEmail, plan.toCreate);
            } catch (error) {
              appendMemberIssue(issues, mapping.groupId, groupEmail, 'add', error);
              throw error;
            }
          }
          if (plan.toDelete.length > 0) {
            try {
              await directory.deleteMembers(groupEmail, plan.toDelete);
            } catch (error) {
              appendMemberIssue(issues, mapping.groupId, groupEmail, 'delete', error);
              throw error;
            }
          }

          outcomes.push({
            kind: 'synchronized',
            groupId: mapping.groupId,
            added: plan.toCreate.length,
            deleted: plan.toDelete.length
          });
        } catch (error) {
          if (isGroupNotFoundError(error)) {
            logger.warn('Google group is gone; skipping it', { group: groupEmail });
            issues.push({
              kind: 'group-skipped',
              groupId: mapping.groupId,
              groupEmail,
              reason: 'group-not-found'
            });
            outcomes.push({ kind: 'skipped', groupId: mapping.groupId, reason: 'group-not-found' });
            continue;
          }

          if (!hasMemberOperationIssue(issues, mapping.groupId, groupEmail)) {
            logger.error('Group synchronization failed', {
              group: mapping.groupId,
              error: errorMessage(error)
            });
            issues.push({
              kind: 'group-failed',
              groupId: mapping.groupId,
              groupEmail,
              message: errorMessage(error)
            });
          }
          outcomes.push({ kind: 'failed', groupId: mapping.groupId, error: errorMessage(error) });
        }
      }

      return { outcomes, issues, mappingsAttempted: mappings.length };
    }
  };
}

function appendMemberIssue(
  issues: RunIssue[],
  groupId: string,
  groupEmail: string,
  operation: 'add' | 'delete',
  error: unknown
): void {
  if (!isMemberOperationFailureError(error)) {
    return;
  }
  issues.push({
    kind: 'member-operation-failed',
    groupId,
    groupEmail,
    operation,
    emails: normalizeEmails(error.failures.map((failure) => failure.email)),
    message: errorMessage(error)
  });
}

function hasMemberOperationIssue(issues: readonly RunIssue[], groupId: string, groupEmail: string): boolean {
  return issues.some(
    (issue) => issue.kind === 'member-operation-failed' && issue.groupId === groupId && issue.groupEmail === groupEmail
  );
}

function isMemberOperationFailureError(error: unknown): error is MemberOperationFailureError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'operation' in error &&
    (error.operation === 'add' || error.operation === 'delete') &&
    'failures' in error &&
    Array.isArray(error.failures)
  );
}

function isGroupNotFoundError(error: unknown): boolean {
  return isRecordWithKind(error, 'group-not-found');
}

function isRecordWithKind(value: unknown, kind: string): value is { readonly kind: string } {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === kind;
}
