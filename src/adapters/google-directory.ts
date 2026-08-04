import { createRequire } from 'node:module';
import type { AppConfig } from '../config.ts';
import type { NormalizedEmail } from '../domain/member.ts';
import { normalizeEmail } from '../domain/member.ts';
import { errorStatusCodes } from '../runtime/errors.ts';
import type { DirectoryClient } from '../ports/directory-client.ts';
import { GroupNotFoundError as MissingGroupError } from '../ports/directory-client.ts';
import type { Logger } from '../ports/logger.ts';
import type { MemberOperationFailure } from '../ports/member-operation-failure.ts';

const require = createRequire(import.meta.url);
const googleModule = require('googleapis') as GoogleModule;

export const GOOGLE_DIRECTORY_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user',
  'https://www.googleapis.com/auth/admin.directory.group',
  'https://www.googleapis.com/auth/admin.directory.group.member'
] as const;

interface GoogleModule {
  readonly google: GoogleNamespace;
}

interface GoogleNamespace {
  readonly auth: {
    readonly JWT: new (options: {
      readonly email: string;
      readonly key: string;
      readonly scopes: readonly string[];
      readonly subject: string;
    }) => JwtClient;
  };
  readonly admin: (version: 'directory_v1') => GoogleDirectoryService;
}

interface JwtClient {
  authorize(callback: (error: unknown, tokens: unknown) => void): void;
}

interface GoogleDirectoryService {
  readonly members: {
    readonly list: LegacyRequest;
    readonly insert: LegacyRequest;
    readonly delete: LegacyRequest;
  };
}

type LegacyRequest = (
  params: Readonly<Record<string, unknown>>,
  callback: (error: unknown, response: GoogleResponse) => void
) => void;

interface GoogleResponse {
  readonly data: unknown;
}

interface GoogleMemberPayload {
  readonly email?: unknown;
}

interface GoogleMemberListPayload {
  readonly members?: unknown;
}

export class MemberOperationError extends Error {
  public readonly operation: 'add' | 'delete';
  public readonly failures: readonly MemberOperationFailure[];

  public constructor(
    operation: 'add' | 'delete',
    failures: readonly MemberOperationFailure[]
  ) {
    super(`${operation} operation failed for ${failures.length} member(s)`);
    this.name = 'MemberOperationError';
    this.operation = operation;
    this.failures = failures;
  }
}

export class GoogleDirectoryClient implements DirectoryClient {
  private readonly jwtClient: JwtClient;
  private readonly google: GoogleNamespace;
  private readonly logger: Logger;

  public constructor(config: AppConfig['google'], logger: Logger) {
    this.google = googleModule.google;
    this.jwtClient = new this.google.auth.JWT({
      email: config.clientEmail,
      key: config.privateKey,
      scopes: GOOGLE_DIRECTORY_SCOPES,
      subject: config.delegatedUser
    });
    this.logger = logger;
  }

  public async getMembers(groupId: string): Promise<readonly NormalizedEmail[]> {
    try {
      const response = await this.request((service) =>
        callLegacy((params, callback) => service.members.list(params, callback), {
          auth: this.jwtClient,
          groupKey: groupId
        })
      );
      return parseGoogleMembers(response);
    } catch (error) {
      if (isGoogleNotFoundError(error)) {
        throw new MissingGroupError(`Google group ${groupId} was not found`);
      }
      throw error;
    }
  }

  public async addMembers(
    groupId: string,
    emails: readonly NormalizedEmail[]
  ): Promise<readonly NormalizedEmail[]> {
    return this.mutateMembers('add', groupId, emails, (service, email) =>
      callLegacy((params, callback) => service.members.insert(params, callback), {
        auth: this.jwtClient,
        groupKey: groupId,
        resource: { email, role: 'MEMBER' }
      })
    );
  }

  public async deleteMembers(
    groupId: string,
    emails: readonly NormalizedEmail[]
  ): Promise<readonly NormalizedEmail[]> {
    return this.mutateMembers('delete', groupId, emails, (service, email) =>
      callLegacy((params, callback) => service.members.delete(params, callback), {
        auth: this.jwtClient,
        groupKey: groupId,
        memberKey: email
      })
    );
  }

  private async mutateMembers(
    operation: 'add' | 'delete',
    groupId: string,
    emails: readonly NormalizedEmail[],
    request: (service: GoogleDirectoryService, email: NormalizedEmail) => Promise<unknown>
  ): Promise<readonly NormalizedEmail[]> {
    const completed: NormalizedEmail[] = [];
    const failures: MemberOperationFailure[] = [];

    for (const [index, email] of emails.entries()) {
      await delay(index * 100);
      try {
        await this.request((service) => request(service, email));
        completed.push(email);
      } catch (error) {
        failures.push({ email, error });
        this.logger.warn(`Could not ${operation} Google group member`, {
          group: groupId,
          operation,
          email,
          memberIndex: index
        });
      }
    }

    if (failures.length > 0) {
      throw new MemberOperationError(operation, failures);
    }
    return completed;
  }

  private request<T>(operation: (service: GoogleDirectoryService) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.jwtClient.authorize((error) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          const service = this.google.admin('directory_v1');
          void operation(service).then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      });
    });
  }
}

export function parseGoogleMembers(value: unknown): readonly NormalizedEmail[] {
  if (!isGoogleMemberListPayload(value)) {
    throw new Error('Google returned an invalid member list response');
  }
  if (value.members === undefined) {
    return [];
  }
  if (!Array.isArray(value.members)) {
    throw new Error('Google returned an invalid members field');
  }

  const emails: NormalizedEmail[] = [];
  for (const member of value.members) {
    if (!isGoogleMemberPayload(member) || typeof member.email !== 'string') {
      continue;
    }
    emails.push(normalizeEmail(member.email));
  }
  return [...new Set(emails)];
}

export function isGoogleNotFoundError(error: unknown): boolean {
  return errorStatusCodes(error).includes(404);
}

function callLegacy(
  request: LegacyRequest,
  params: Readonly<Record<string, unknown>>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request(params, (error, response) => {
      if (error) {
        reject(error);
      } else {
        resolve(response.data);
      }
    });
  });
}

function isGoogleMemberListPayload(value: unknown): value is GoogleMemberListPayload {
  return typeof value === 'object' && value !== null;
}

function isGoogleMemberPayload(value: unknown): value is GoogleMemberPayload {
  return typeof value === 'object' && value !== null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
