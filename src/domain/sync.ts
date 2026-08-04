import type { DirectoryClient } from '../ports/directory-client.ts';
import type { Logger } from '../ports/logger.ts';
import type { OdooClient } from '../ports/odoo-client.ts';
import type { GroupMapping, GroupOutcome, RunSummary, SyncPlan } from './group.ts';
import type { Member, NormalizedEmail } from './member.ts';
import { normalizeEmail } from './member.ts';
import { errorMessage } from '../runtime/errors.ts';

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
            await directory.addMembers(groupEmail, plan.toCreate);
          }
          if (plan.toDelete.length > 0) {
            await directory.deleteMembers(groupEmail, plan.toDelete);
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
            outcomes.push({ kind: 'skipped', groupId: mapping.groupId, reason: 'group-not-found' });
            continue;
          }

          logger.error('Group synchronization failed', {
            group: mapping.groupId,
            error: errorMessage(error)
          });
          outcomes.push({ kind: 'failed', groupId: mapping.groupId, error });
        }
      }

      return { outcomes };
    }
  };
}

function isGroupNotFoundError(error: unknown): boolean {
  return isRecordWithKind(error, 'group-not-found');
}

function isRecordWithKind(value: unknown, kind: string): value is { readonly kind: string } {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === kind;
}
