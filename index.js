require('dotenv').config();
const difference = require('lodash/difference');
const uniq = require('lodash/uniq');
const getOdooMembersFromGroups = require('./odoo');
const { addMembers, getMembers, deleteMembers } = require('./directory');
const groupMap = JSON.parse(process.env.GROUPMAP);

async function main() {
  for (const [odooIds, groupId, excludeParents] of groupMap) {
    // cannot run in parallel, since the api does not support concurrent usage...
    await syncGroup(odooIds, groupId + '@valhallagruppe.dk', excludeParents);
  }
}

main()
  .then(() => console.log(new Date(), 'Synchronized successfully'))
  .catch(console.error);

function syncGroup(odooIds, groupId, excludeParents = false) {
  const googleMembersPromise = getMembers(groupId).then(r =>
    r.members ? r.members.map(u => u.email.toLowerCase().trim()) : []
  );
  const odooMembersPromise = getOdooMembersFromGroups(odooIds, excludeParents).then(users =>
    users.map(u => u.email.toLowerCase().trim())
  );
  return Promise.all([googleMembersPromise, odooMembersPromise])
    .then(([googleMembers, odooMembers]) => {
      const toCreate = uniq(difference(odooMembers, googleMembers));
      log('ToCreate: ', toCreate);
      const toDelete = uniq(difference(googleMembers, odooMembers));
      log('ToDelete: ', toDelete);
      const toCreatePromise = toCreate.length ? addMembers(groupId, toCreate) : Promise.resolve();
      return toCreatePromise.then(() => (toDelete.length ? deleteMembers(groupId, toDelete) : Promise.resolve()));
    })
    .catch(r => console.log(r));
}

function log(label, names) {
  if (names.length) {
    console.log(label + ': ', names);
  }
}
