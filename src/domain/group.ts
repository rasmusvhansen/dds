import type { NormalizedEmail } from './member.ts';

export type OdooGroupId = number;
export type OdooGroupIds = OdooGroupId | readonly OdooGroupId[];

export interface GroupMapping {
  readonly odooIds: OdooGroupIds;
  readonly groupId: string;
  readonly excludeParents: boolean;
}

export interface SyncPlan {
  readonly toCreate: readonly NormalizedEmail[];
  readonly toDelete: readonly NormalizedEmail[];
}

export type GroupOutcome =
  | {
      readonly kind: 'synchronized';
      readonly groupId: string;
      readonly added: number;
      readonly deleted: number;
    }
  | {
      readonly kind: 'skipped';
      readonly groupId: string;
      readonly reason: 'group-not-found';
    }
  | {
      readonly kind: 'failed';
      readonly groupId: string;
      readonly error: unknown;
    };

export interface RunSummary {
  readonly outcomes: readonly GroupOutcome[];
}
