const Odoo = require("odoo-xmlrpc");
const uniqBy = require("lodash/uniqBy");
const odoo = new Odoo({
  url: process.env.ODOOURL,
  port: 443,
  db: process.env.ODOODB,
  username: process.env.ODOOUSER,
  password: process.env.ODOOPASSWORD
});

const flatMap = (f, arr) => arr.reduce((x, y) => [...x, ...f(y)], []);

function getOdooMembers(id, limit = 10) {
  return new Promise((resolve, reject) => {
    odoo.connect(function (err) {
      if (err) {
        reject(err);
      }
      console.log("Connected to Odoo server.");
      var inParams = [];
      inParams.push([
        ["member_id.function_ids.organization_id", "child_of", id],
        ["organization_id", "=", 859]
      ]);
      inParams.push([
        "organization_id",
        "member_number",
        "name",
        "member_id",
        "email",
        "relation_all_ids"
      ]); //fields
      inParams.push(0); //offset
      inParams.push(limit); //limit
      var params = [];
      params.push(inParams);
      odoo.execute_kw("member.profile", "search_read", params, function (
        err,
        value
      ) {
        if (err) {
          reject(err);
        }
        value = value || [];
        const emails = value
          .filter(m => m.email)
          .map(m => ({ name: m.name, email: m.email }));

        const relationIds = flatMap(m => m.relation_all_ids, value);

        const relationParams = [[relationIds, ["other_partner_id", "type_id"]]];
        odoo.execute_kw(
          "res.partner.relation.all",
          "read",
          relationParams,
          function (err, value) {
            if (err) {
              reject(err);
            }
            value = value || [];
            const idsToFetch = value
              .filter(m => m.type_id[1] === "Forældre til")
              .map(m => m.other_partner_id[0]);

            const parentParams = [[idsToFetch, ["email", "name"]]];
            odoo.execute_kw("res.partner", "read", parentParams, function (
              err,
              value
            ) {
              if (err) {
                reject(err);
              }
              value = value || [];
              //console.log(value);
              const allEmails = [
                ...emails,
                ...value
                  .filter(m => m.email)
                  .map(m => ({ name: m.name, email: m.email }))
              ];
              resolve(uniqBy(allEmails, p => p.email));
            });
          }
        );
      });
    });
  });
}

module.exports = getOdooMembers;
