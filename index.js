require('dotenv').config();
const difference = require('lodash/difference');
const getOdooMembers = require('./odoo');
const { addMembers, getMembers, deleteMembers } = require('./directory');
const groupMap = JSON.parse(process.env.GROUPMAP);

async function main() {
  for (const [odooId, groupId] of groupMap) {
    // cannot run in parallel, since the api does not support concurrent usage...
    await syncGroup(odooId, groupId + '@valhallagruppe.dk');
  }
}

main()
  .then(() => console.log('Synchronized successfully'))
  .catch(console.error);

function syncGroup(odooId, groupId) {
  const googleMembersPromise = getMembers(groupId).then(
    r => (r.members ? r.members.map(u => u.email.toLowerCase()) : [])
  );
  const odooMembersPromise = getOdooMembers(odooId, 1000).then(users => users.map(u => u.email.toLowerCase()));
  return Promise.all([googleMembersPromise, odooMembersPromise])
    .then(([googleMembers, odooMembers]) => {
      const toCreate = difference(odooMembers, googleMembers);
      const toDelete = difference(googleMembers, odooMembers);
      const toCreatePromise = toCreate.length ? addMembers(groupId, toCreate) : Promise.resolve();
      return toCreatePromise.then(() => (toDelete.length ? deleteMembers(groupId, toDelete) : Promise.resolve));
    })
    .catch(r => console.log(r));
}
