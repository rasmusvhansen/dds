import assert from 'node:assert/strict';
import test from 'node:test';
import { GroupNotFoundError } from '../src/ports/directory-client.ts';
import { createSynchronizer, normalizeEmails, planMembership } from '../src/domain/sync.ts';
import { normalizeEmail } from '../src/domain/member.ts';
import type { GroupMapping } from '../src/domain/group.ts';
import type { DirectoryClient } from '../src/ports/directory-client.ts';
import type { OdooClient } from '../src/ports/odoo-client.ts';
import type { Logger } from '../src/ports/logger.ts';

const logger: Logger = {
  info() {},
  warn() {},
  error() {}
};

function mapping(groupId: string): GroupMapping {
  return { odooIds: 1, groupId, excludeParents: false };
}

test('normalizes and deduplicates email addresses', () => {
  assert.deepEqual(normalizeEmails([' A@Example.com ', 'a@example.com', 'b@example.com']), [
    'a@example.com',
    'b@example.com'
  ]);
});

test('plans additions and deletions from normalized membership', () => {
  const plan = planMembership(
    ['existing@example.com', ' REMOVE@example.com '],
    [
      { name: 'Existing', email: ' EXISTING@example.com ' },
      { name: 'New', email: 'new@example.com' }
    ]
  );
  assert.deepEqual(plan.toCreate, ['new@example.com']);
  assert.deepEqual(plan.toDelete, ['remove@example.com']);
});

test('adds before deleting and continues after a failed group', async () => {
  const calls: string[] = [];
  const directory: DirectoryClient = {
    async getMembers(groupId) {
      calls.push(`get:${groupId}`);
      if (groupId.startsWith('missing')) {
        throw new GroupNotFoundError(groupId);
      }
      if (groupId.startsWith('failed')) {
        throw new Error('temporary failure');
      }
      return [normalizeEmail('old@example.com')];
    },
    async addMembers(groupId, emails) {
      calls.push(`add:${groupId}:${emails.join(',')}`);
      return emails;
    },
    async deleteMembers(groupId, emails) {
      calls.push(`delete:${groupId}:${emails.join(',')}`);
      return emails;
    }
  };
  const odoo: OdooClient = {
    async getMembers() {
      return [{ name: 'New', email: 'new@example.com' }];
    }
  };

  const summary = await createSynchronizer(directory, odoo, logger).run([
    mapping('first'),
    mapping('missing'),
    mapping('failed'),
    mapping('last')
  ]);

  assert.deepEqual(calls, [
    'get:first@valhallagruppe.dk',
    'add:first@valhallagruppe.dk:new@example.com',
    'delete:first@valhallagruppe.dk:old@example.com',
    'get:missing@valhallagruppe.dk',
    'get:failed@valhallagruppe.dk',
    'get:last@valhallagruppe.dk',
    'add:last@valhallagruppe.dk:new@example.com',
    'delete:last@valhallagruppe.dk:old@example.com'
  ]);
  assert.deepEqual(summary.outcomes.map((outcome) => outcome.kind), [
    'synchronized',
    'skipped',
    'failed',
    'synchronized'
  ]);
});
