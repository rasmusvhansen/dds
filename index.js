require('dotenv').config();
const difference = require("lodash/difference");
const getOdooMembers = require("./odoo");
const { addMembers, getMembers, deleteMembers } = require("./directory");

const groupMap = [
  [3654, "sync-mini"],
  [3652, "sync-fam"],
  [8808, "sync-aser"],
  [3657, "sync-heidrun"],
  [3658, "sync-quark"],
  [3656, "sync-trop"],
  [3655, "sync-junior"],
];

async function main() {
  for (const [odooId, groupId] of groupMap) {
    await syncGroup(odooId, groupId + "@valhallagruppe.dk");
  }
}

main()
  .then(console.log)
  .catch(console.error)

function syncGroup(odooId, groupId) {
  const googleMembersPromise = getMembers(groupId).then(r => r.members ? r.members.map(u => u.email.toLowerCase()) : []);
  const odooMembersPromise = getOdooMembers(odooId, 1000).then(users => users.map(u => u.email.toLowerCase()));
  return Promise.all([
    googleMembersPromise,
    odooMembersPromise]
  ).then(([googleMembers, odooMembers]) => {
    const toCreate = difference(odooMembers, googleMembers);
    const toDelete = difference(googleMembers, odooMembers);
    if (toCreate.length) {
      return addMembers(groupId, toCreate).then(() => {
        if (toDelete.length) {
          return deleteMembers(groupId, toDelete);
        }
      });
    } else {
      if (toDelete.length) {
        return deleteMembers(groupId, toDelete);
      }
    }
  })
    .catch(r => console.log(r));
}