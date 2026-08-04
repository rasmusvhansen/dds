import { createRequire } from 'node:module';
import type { AppConfig } from '../config.ts';
import type { Member } from '../domain/member.ts';
import type { OdooGroupIds } from '../domain/group.ts';
import type { Logger } from '../ports/logger.ts';

const require = createRequire(import.meta.url);
const Odoo = require('odoo-xmlrpc') as OdooConstructor;

interface OdooConstructor {
  new (options: Readonly<Record<string, unknown>>): OdooConnection;
}

interface OdooConnection {
  connect(callback: (error: unknown) => void): void;
  execute_kw(
    model: string,
    method: string,
    params: readonly unknown[],
    callback: (error: unknown, value: unknown) => void
  ): void;
}

interface OdooMemberRecord {
  readonly name?: unknown;
  readonly email?: unknown;
  readonly relation_all_ids?: unknown;
  readonly active_function_ids?: unknown;
}

interface OdooRelationRecord {
  readonly other_partner_id?: unknown;
  readonly type_selection_id?: unknown;
}

interface OdooFunctionRecord {
  readonly function_type_id?: unknown;
  readonly organization_id?: unknown;
}

interface OdooPartnerRecord {
  readonly name?: unknown;
  readonly email?: unknown;
}

export class OdooXmlRpcClient {
  private readonly client: OdooConnection;
  private readonly config: AppConfig['odoo'];
  private readonly logger: Logger;

  public constructor(config: AppConfig['odoo'], logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.client = new Odoo({
      url: config.url,
      port: config.port,
      db: config.database,
      username: config.username,
      password: config.password
    });
  }

  public async getMembers(
    groupIds: OdooGroupIds,
    excludeParents: boolean
  ): Promise<readonly Member[]> {
    const ids = Array.isArray(groupIds) ? groupIds : [groupIds];
    const members: Member[] = [];

    for (const id of ids) {
      const groupMembers = await this.getMembersForGroup(id, excludeParents);
      members.push(...groupMembers);
    }

    return deduplicateMembers(members);
  }

  private async getMembersForGroup(
    id: number,
    excludeParents: boolean
  ): Promise<readonly Member[]> {
    await this.connect();
    this.logger.info('Connected to Odoo server');

    const value = await this.execute(
      'member.profile',
      'search_read',
      [[
        [['member_id.function_ids.organization_id', 'child_of', id], ['organization_id', '=', this.config.organizationId]],
        [
          'organization_id',
          'member_number',
          'name',
          'member_id',
          'email',
          'relation_all_ids',
          'active_function_ids',
          'function_type_ids'
        ],
        0,
        1000
      ]]
    );
    const profiles = value.filter(isOdooMemberRecord);
    const ownMembers = mapOdooMembers(profiles);

    this.logger.info('Read Odoo members', { group: id, excludeParents, count: ownMembers.length });
    if (excludeParents) {
      return ownMembers;
    }

    const relationIds: number[] = [];
    for (const member of profiles) {
      const activeFunctionIds = toNumberArray(member.active_function_ids);
      if (activeFunctionIds.length > 1) {
        const functionTypes = await this.getFunctionTypes(activeFunctionIds);
        if (shouldIncludeParentRelations(id, activeFunctionIds, functionTypes, this.config.leaderFunctionTypeId)) {
          relationIds.push(...toNumberArray(member.relation_all_ids));
        }
      } else {
        relationIds.push(...toNumberArray(member.relation_all_ids));
      }
    }

    const relations = await this.execute(
      'res.partner.relation.all',
      'read',
      [[relationIds, ['other_partner_id', 'type_selection_id', 'email', 'name']]]
    );
    const parentIds = filterParentIds(relations, this.config.parentRelationTypeId);

    const parents = await this.execute('res.partner', 'read', [[parentIds, ['email', 'name']]]);
    const parentMembers = mapOdooMembers(parents.filter(isOdooPartnerRecord));
    this.logger.info('Read Odoo parent relations', { group: id, count: parentMembers.length });
    return deduplicateMembers([...ownMembers, ...parentMembers]);
  }

  private async getFunctionTypes(ids: readonly number[]): Promise<readonly OdooFunctionRecord[]> {
    const value = await this.execute('member.function', 'read', [[ids, ['id', 'active', 'function_type_id', 'organization_id']]]);
    return value.filter(isOdooFunctionRecord);
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.connect((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  private execute(model: string, method: string, params: readonly unknown[]): Promise<readonly unknown[]> {
    return new Promise((resolve, reject) => {
      this.client.execute_kw(model, method, params, (error, value) => {
        if (error) {
          reject(error);
          return;
        }
        if (value === undefined || value === null) {
          resolve([]);
          return;
        }
        if (!Array.isArray(value)) {
          reject(new Error(`Odoo returned an invalid response for ${model}.${method}`));
          return;
        }
        resolve(value);
      });
    });
  }
}

export function mapOdooMembers(records: readonly unknown[]): readonly Member[] {
  return records.filter(isOdooMemberRecord).flatMap(toMember);
}

export function shouldIncludeParentRelations(
  organizationId: number,
  activeFunctionIds: readonly number[],
  functionTypes: readonly OdooFunctionRecord[],
  leaderFunctionTypeId: number
): boolean {
  if (activeFunctionIds.length <= 1) {
    return true;
  }
  return !functionTypes.some(
    (functionType) =>
      tupleId(functionType.organization_id) === organizationId &&
      tupleId(functionType.function_type_id) !== leaderFunctionTypeId
  );
}

export function filterParentIds(
  relations: readonly unknown[],
  parentRelationTypeId: number
): readonly number[] {
  return relations
    .filter(isOdooRelationRecord)
    .filter((relation) => tupleId(relation.type_selection_id) === parentRelationTypeId)
    .map((relation) => tupleId(relation.other_partner_id))
    .filter((partnerId): partnerId is number => partnerId !== undefined);
}

function toMember(record: OdooMemberRecord | OdooPartnerRecord): readonly Member[] {
  return typeof record.email === 'string' && record.email.trim() !== ''
    ? [{ name: typeof record.name === 'string' ? record.name : '', email: record.email }]
    : [];
}

function deduplicateMembers(members: readonly Member[]): readonly Member[] {
  const byEmail = new Map<string, Member>();
  for (const member of members) {
    const key = member.email.trim().toLowerCase();
    if (!byEmail.has(key)) {
      byEmail.set(key, member);
    }
  }
  return [...byEmail.values()];
}

function isOdooMemberRecord(value: unknown): value is OdooMemberRecord {
  return isRecord(value);
}

function isOdooRelationRecord(value: unknown): value is OdooRelationRecord {
  return isRecord(value);
}

function isOdooFunctionRecord(value: unknown): value is OdooFunctionRecord {
  return isRecord(value);
}

function isOdooPartnerRecord(value: unknown): value is OdooPartnerRecord {
  return isRecord(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toNumberArray(value: unknown): readonly number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item) => (typeof item === 'number' && Number.isInteger(item) ? [item] : []));
}

function tupleId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'number' && Number.isInteger(value[0])) {
    return value[0];
  }
  return undefined;
}
