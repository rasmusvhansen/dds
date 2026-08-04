import { createRequire } from 'node:module';
import type { GroupMapping, OdooGroupId } from './domain/group.ts';

const require = createRequire(import.meta.url);
const dotenv = require('dotenv') as { readonly config: () => void };
dotenv.config();

export interface AppConfig {
  readonly google: {
    readonly clientEmail: string;
    readonly privateKey: string;
    readonly delegatedUser: string;
    readonly groupDomain: string;
  };
  readonly odoo: {
    readonly url: string;
    readonly port: number;
    readonly database: string;
    readonly username: string;
    readonly password: string;
    readonly organizationId: number;
    readonly parentRelationTypeId: number;
    readonly leaderFunctionTypeId: number;
  };
  readonly groupMap: readonly GroupMapping[];
}

type RawGroupMapping = readonly [unknown, unknown, unknown?];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const groupMapText = required(env, 'GROUPMAP');
  let parsed: unknown;
  try {
    parsed = JSON.parse(groupMapText);
  } catch {
    throw new Error('GROUPMAP must contain valid JSON');
  }

  return {
    google: {
      clientEmail: required(env, 'CLIENTEMAIL'),
      privateKey: privateKey(env),
      delegatedUser: required(env, 'GOOGLEUSER'),
      groupDomain: optional(env, 'GROUPDOMAIN') ?? 'valhallagruppe.dk'
    },
    odoo: {
      url: required(env, 'ODOOURL'),
      port: integer(optional(env, 'ODOOPORT') ?? '443', 'ODOOPORT'),
      database: required(env, 'ODOODB'),
      username: required(env, 'ODOOUSER'),
      password: required(env, 'ODOOPASSWORD'),
      organizationId: integer(optional(env, 'ODOOORGANIZATIONID') ?? '859', 'ODOOORGANIZATIONID'),
      parentRelationTypeId: integer(
        optional(env, 'ODOOPARENTRELATIONTYPEID') ?? '9',
        'ODOOPARENTRELATIONTYPEID'
      ),
      leaderFunctionTypeId: integer(
        optional(env, 'ODOOLEADERFUNCTIONTYPEID') ?? '1',
        'ODOOLEADERFUNCTIONTYPEID'
      )
    },
    groupMap: parseGroupMap(parsed)
  };
}

function parseGroupMap(value: unknown): readonly GroupMapping[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error('GROUPMAP must be a non-empty array of [odooIds, groupId, excludeParents] entries');
  }

  return value.map((entry, index) => {
    if (!Array.isArray(entry) || entry.length < 2 || entry.length > 3) {
      throw new Error(`GROUPMAP entry ${index} must contain two or three values`);
    }

    const [rawIds, rawGroupId, rawExcludeParents] = entry as unknown as RawGroupMapping;
    const odooIds = parseOdooIds(rawIds, index);
    if (typeof rawGroupId !== 'string' || rawGroupId.trim() === '') {
      throw new Error(`GROUPMAP entry ${index} groupId must be a non-empty string`);
    }
    if (rawExcludeParents !== undefined && typeof rawExcludeParents !== 'boolean') {
      throw new Error(`GROUPMAP entry ${index} excludeParents must be a boolean`);
    }

    return {
      odooIds,
      groupId: rawGroupId.trim(),
      excludeParents: rawExcludeParents ?? false
    };
  });
}

function parseOdooIds(value: unknown, index: number): OdooGroupId | readonly OdooGroupId[] {
  if (isValidOdooId(value)) {
    return value;
  }
  if (Array.isArray(value) && value.length > 0 && value.every(isValidOdooId)) {
    return [...value];
  }
  throw new Error(`GROUPMAP entry ${index} odooIds must be an integer or non-empty integer array`);
}

function isValidOdooId(value: unknown): value is OdooGroupId {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function privateKey(env: NodeJS.ProcessEnv): string {
  const value = required(env, 'PRIVATEKEY').replaceAll('\\n', '\n');
  if (!/-----BEGIN (?:RSA )?PRIVATE KEY-----[^]+-----END (?:RSA )?PRIVATE KEY-----/.test(value)) {
    throw new Error('PRIVATEKEY must contain a valid PEM private key');
  }
  return value;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value.trim();
}

function optional(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function integer(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return Number(value);
}
