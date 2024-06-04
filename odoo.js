// 'Barn af (9)' når det er barnet der er medlem og relations er forældre
// 'Forældre til(10)' når det er forældre der er medlem og relations er barnet


const Odoo = require('odoo-xmlrpc');
const uniqBy = require('lodash/uniqBy');
const odoo = new Odoo({
  url: process.env.ODOOURL,
  port: 443,
  db: process.env.ODOODB,
  username: process.env.ODOOUSER,
  password: process.env.ODOOPASSWORD
});

const flatMap = (f, arr) => arr.reduce((x, y) => [...x, ...f(y)], []);
async function getMembersForManyGroups(ids, excludeParents) {
  if (ids instanceof Array) {
    let allMembers = [];
    for (const id of ids) {
      // cannot run in parallel, since the api does not support concurrent usage...
      const members = await getOdooMembers(id, excludeParents);
      allMembers = [...allMembers, ...members];
    }
    return allMembers;
  }
  return getOdooMembers(ids, excludeParents);
}

async function getOdooMembers(id, excludeParents, limit = 1000, ) {
  return new Promise((resolve, reject) => {
    odoo.connect(function(err) {
      if (err) {
        reject(err);
        return;
      }
      console.log(new Date(), 'Connected to Odoo server.');
      const params = [
        [['member_id.function_ids.organization_id', 'child_of', id], ['organization_id', '=', 859]],
        ['organization_id', 'member_number', 'name', 'member_id', 'email', 'relation_all_ids', 'active_function_ids', 'function_type_ids'],
        0,
        limit
      ];

      odoo.execute_kw('member.profile', 'search_read', [params], async function(err, value) {
        if (err) {
          reject(err);
          return;
        }
        console.log('reading members of ' + id, 'Excludeparents', excludeParents);
        value = value || [];
        const emails = value.filter(m => m.email).map(m => ({ name: m.name, email: m.email }));

        if (excludeParents) {
          resolve(emails);
          return;
        }

        const relationIds = [];
        for (const member of value) {
          if (member.active_function_ids.length > 1) {
            const functionTypeIds = await getFunctionTypeIds(member.active_function_ids);
            if (!functionTypeIds.some(f => f.organization_id[0] === id && f.function_type_id[0] !== 1)) {
              // ikke leder af org
              relationIds.push(...member.relation_all_ids);
            }
          } else {
            relationIds.push(...member.relation_all_ids);
          }
        }
        

        const relationParams = [[relationIds, ['other_partner_id', 'type_selection_id', 'email', 'name']]];
        odoo.execute_kw('res.partner.relation.all', 'read', relationParams, function(err, value) {
          if (err) {
            reject(err);
            return;
          }
          console.log('reading relations of ' + id);
          value = value || [];
          const idsToFetch = value.filter(m => m.type_selection_id[0] === 9).map(m => m.other_partner_id[0]);
          

          const parentParams = [[idsToFetch, ['email']]];
          odoo.execute_kw('res.partner', 'read', parentParams, function(err, value) {
            if (err) {
              reject(err);
            }
            value = value || [];
            const allEmails = [...emails, ...value.filter(m => m.email).map(m => ({ name: m.name, email: m.email }))];
            resolve(uniqBy(allEmails, p => p.email));
          });
        });
      });
    });
  });
}

async function getFunctionTypeIds(functionIds) {
  return new Promise((resolve, reject) => {
    const params = [
      functionIds,
      ['id', 'active', 'function_type_id', 'organization_id']
      
    ];
  
    odoo.execute_kw('member.function', 'read', [params], function(err, value) {
      if (err) {
        reject(err);
        return;
      }
      
      resolve(value);
    });
  });  
}

module.exports = getMembersForManyGroups;
