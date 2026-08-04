import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterParentIds,
  mapOdooMembers,
  shouldIncludeParentRelations
} from '../src/adapters/odoo-xmlrpc.ts';

test('maps Odoo records with email even when name is absent', () => {
  assert.deepEqual(mapOdooMembers([{ email: 'member@example.com' }, { email: '' }, { name: 'No email' }]), [
    { name: '', email: 'member@example.com' }
  ]);
});

test('filters only configured parent relation records', () => {
  assert.deepEqual(
    filterParentIds(
      [
        { other_partner_id: [10, 'Parent'], type_selection_id: [9, 'Parent of'] },
        { other_partner_id: [20, 'Child'], type_selection_id: [10, 'Child of'] }
      ],
      9
    ),
    [10]
  );
});

test('preserves the existing leader parent exclusion rule', () => {
  assert.equal(shouldIncludeParentRelations(42, [1, 2], [{ organization_id: [42], function_type_id: [1] }], 1), true);
  assert.equal(shouldIncludeParentRelations(42, [1, 2], [{ organization_id: [42], function_type_id: [2] }], 1), false);
  assert.equal(shouldIncludeParentRelations(42, [1], [{ organization_id: [42], function_type_id: [2] }], 1), true);
});
