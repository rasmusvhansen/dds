import type { Member } from '../domain/member.ts';
import type { OdooGroupIds } from '../domain/group.ts';

export interface OdooClient {
  getMembers(groupIds: OdooGroupIds, excludeParents: boolean): Promise<readonly Member[]>;
}
