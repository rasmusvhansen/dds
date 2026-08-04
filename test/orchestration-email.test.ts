import assert from 'node:assert/strict';
import test from 'node:test';
import { runApplication, type ApplicationDependencies } from '../index.ts';
import type { AppConfig } from '../src/config.ts';
import type { DirectoryClient } from '../src/ports/directory-client.ts';
import type { IssueEmailClient } from '../src/ports/issue-email-client.ts';
import type { OdooClient } from '../src/ports/odoo-client.ts';
import { MemberOperationError } from '../src/adapters/google-directory.ts';
import { normalizeEmail } from '../src/domain/member.ts';

const config: AppConfig = {
  email: {
    apiKey: 'test-key',
    fromEmail: 'sender@example.com',
    toEmails: ['ops@example.com']
  },
  google: {
    clientEmail: 'service@example.com',
    privateKey: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----',
    delegatedUser: 'admin@example.com',
    groupDomain: 'example.com'
  },
  odoo: {
    url: 'https://odoo.example.com',
    port: 443,
    database: 'database',
    username: 'user',
    password: 'password',
    organizationId: 859,
    parentRelationTypeId: 9,
    leaderFunctionTypeId: 1
  },
  groupMap: [{ odooIds: 1, groupId: 'group', excludeParents: false }]
};

function dependencies(
  getMembers: DirectoryClient['getMembers'],
  email: IssueEmailClient
): ApplicationDependencies {
  const directory: DirectoryClient = {
    getMembers,
    async addMembers(_group, emails) {
      return emails;
    },
    async deleteMembers(_group, emails) {
      return emails;
    }
  };
  const odoo: OdooClient = {
    async getMembers() {
      return [];
    }
  };
  return { directory, odoo, email };
}

test('healthy runs do not send email', async () => {
  let sends = 0;
  await runApplication(
    config,
    dependencies(async () => [], { async sendSummary() { sends += 1; } })
  );
  assert.equal(sends, 0);
});

test('warning runs send one summary after all mappings', async () => {
  const events: string[] = [];
  const warningConfig = { ...config, groupMap: [
    { odooIds: 1, groupId: 'missing', excludeParents: false },
    { odooIds: 1, groupId: 'ok', excludeParents: false }
  ] };
  await runApplication(
    warningConfig,
    dependencies(async (group) => {
      events.push(`get:${group}`);
      if (group.startsWith('missing')) {
        const error = new Error('missing');
        Object.assign(error, { kind: 'group-not-found' });
        throw error;
      }
      return [];
    }, { async sendSummary(summary) { events.push(`email:${summary.issues.length}`); } })
  );
  assert.deepEqual(events, [
    'get:missing@example.com',
    'get:ok@example.com',
    'email:1'
  ]);
});

test('member-operation failures trigger one email and a nonzero run status', async () => {
  process.exitCode = 0;
  let receivedSummary: Parameters<IssueEmailClient['sendSummary']>[0] | undefined;
  const directory: DirectoryClient = {
    async getMembers() {
      return [];
    },
    async addMembers() {
      throw new MemberOperationError('add', [{
        email: normalizeEmail(' Person@Example.com '),
        error: new Error('provider rejected member')
      }]);
    },
    async deleteMembers(_group, emails) {
      return emails;
    }
  };
  const odoo: OdooClient = {
    async getMembers() {
      return [{ name: 'Person', email: 'person@example.com' }];
    }
  };

  await runApplication(config, {
    directory,
    odoo,
    email: { async sendSummary(summary) { receivedSummary = summary; } }
  });

  assert.equal(process.exitCode, 1);
  assert.equal(receivedSummary?.issues.length, 1);
  assert.deepEqual(receivedSummary?.issues[0], {
    kind: 'member-operation-failed',
    groupId: 'group',
    groupEmail: 'group@example.com',
    operation: 'add',
    emails: ['person@example.com'],
    message: 'add operation failed for 1 member(s)'
  });
  process.exitCode = 0;
});

test('email delivery failure does not replace a failed synchronization status', async () => {
  process.exitCode = 0;
  const directory: DirectoryClient = {
    async getMembers() {
      return [];
    },
    async addMembers() {
      throw new MemberOperationError('add', [{
        email: normalizeEmail('person@example.com'),
        error: new Error('provider rejected member')
      }]);
    },
    async deleteMembers(_group, emails) {
      return emails;
    }
  };
  const odoo: OdooClient = {
    async getMembers() {
      return [{ name: 'Person', email: 'person@example.com' }];
    }
  };

  await runApplication(config, {
    directory,
    odoo,
    email: { async sendSummary() { throw new Error('mailer unavailable'); } }
  });

  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test('email delivery failure does not replace a successful run status', async () => {
  process.exitCode = 0;
  await runApplication(
    config,
    dependencies(async () => {
      const error = new Error('missing');
      Object.assign(error, { kind: 'group-not-found' });
      throw error;
    }, { async sendSummary() { throw new Error('mailer unavailable'); } })
  );
  assert.equal(process.exitCode, 0);
});
