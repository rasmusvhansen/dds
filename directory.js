var { google } = require("googleapis");

var jwtClient = new google.auth.JWT(
  process.env.CLIENTEMAIL,
  null,
  process.env.PRIVATEKEY.replace(/\\n/g, '\n'),
  [
    "https://www.googleapis.com/auth/admin.directory.user",
    "https://www.googleapis.com/auth/admin.directory.group",
    "https://www.googleapis.com/auth/admin.directory.group.member"
  ], // an array of auth scopes
  process.env.GOOGLEUSER
);

const delay = (fn, ms) => new Promise(resolve => setTimeout(() => resolve(fn()), ms));
const promisify = (fn) => (params) => new Promise((resolve, reject) => fn(params, (err, response) => {
  if (err)
    reject(err)
  else
    resolve(response.data);
}))

function getMembers(groupId) {
  return makeRequests(service => {
    return promisify(service.members.list)({
      auth: jwtClient,
      groupKey: groupId
    })
  })
}

function addMembers(groupId, emails) {
  console.log(`adding \n${emails.join("\n")}`);
  return makeRequests((service) => {
    return Promise.all(emails.map((email, i) => {
      return delay(() => promisify(service.members.insert)({
        auth: jwtClient,
        groupKey: groupId,
        resource: {
          "email": email,
          "role": "MEMBER"
        }
      })
        , i * 100)
    }))
  })
}

function deleteMembers(groupId, emails) {
  console.log(`deleting \n${emails.join("\n")}`);
  return makeRequests((service) => {
    return Promise.all(emails.map((email, i) => {
      return delay(() => promisify(service.members.delete)({
        auth: jwtClient,
        groupKey: groupId,
        memberKey: email
      })
        , i * 100)
    }))
  })
}

function makeRequests(doRequest) {
  return new Promise((resolve, reject) => {
    jwtClient.authorize(function (err, tokens) {
      if (err) {
        reject(err);
      } else {
        var service = google.admin("directory_v1");
        resolve(doRequest(service));
      }
    });
  })

}

module.exports = {
  addMembers,
  getMembers,
  deleteMembers
}