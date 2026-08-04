import type { NormalizedEmail } from '../domain/member.ts';

export class GroupNotFoundError extends Error {
  public readonly kind = 'group-not-found';

  public constructor(message: string) {
    super(message);
    this.name = 'GroupNotFoundError';
  }
}

export interface DirectoryClient {
  getMembers(groupId: string): Promise<readonly NormalizedEmail[]>;
  addMembers(groupId: string, emails: readonly NormalizedEmail[]): Promise<readonly NormalizedEmail[]>;
  deleteMembers(groupId: string, emails: readonly NormalizedEmail[]): Promise<readonly NormalizedEmail[]>;
}
