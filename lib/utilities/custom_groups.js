const {
  parseFilter,
} = require('ldapjs');
const {
  getProviderLDAPEntries,
} = require('./provider');
const {
  makeGroupEntry,
  addMemberToGroup,
} = require('./ldap');
const {
  customGroups,
} = require('../config');


function getLDAPCustomGroupEntries() {
  if (!customGroups) {
    return [];
  }

  const baseGroupEntry = makeGroupEntry('ou=CustomGroups', 'CustomGroups', []);
  const allEntries = getProviderLDAPEntries();

  const groupEntries = customGroups.map(g => {
    const groupEntry = makeGroupEntry(`ou=${g.name},ou=CustomGroups`, g.name, []);
    addMemberToGroup(groupEntry, baseGroupEntry);

    const members = allEntries.filter(o => {
      return g.members.indexOf(o.attributes.mail) >= 0;
    });

    members.forEach(p => {
      addMemberToGroup(p, groupEntry);
    });

    return groupEntry;
  });

  return [].concat(baseGroupEntry, groupEntries);
}

module.exports = {
  getLDAPCustomGroupEntries,
};
