const {
  ldap: ldapConfig,
} = require('../config');

let cachedBaseEntries = null;

function getRootDN() {
  return ldapConfig.rootDN;
}

function makeDN(...parts) {
  return parts.join(',');
}

function getOrganizationBaseDN() {
  return makeDN('o=' + ldapConfig.organization, getRootDN());
}

function getPeopleBaseDN() {
  const dn = makeDN('ou=People', getOrganizationBaseDN());
  return dn;
}

function getGroupsBaseDN() {
  const dn = makeDN('ou=Groups', getOrganizationBaseDN());
  return dn;
}

function makeGroupEntryDN(...prefix) {
  const dn = makeDN(...prefix, getGroupsBaseDN());
  return dn;
}

function makeOrganizationUnitEntryDN(...prefix) {
  const dn = makeDN(...prefix, getPeopleBaseDN());
  return dn;
}

function makeOrganizationUnitEntry(dn, name, attrs = {}) {
  // dn: d.dn,
  // attributes: {
  //   objectclass: ['organizationalUnit', 'top'],
  //   ou: d.name,
  // }
  const generatedDN = makeOrganizationUnitEntryDN(dn);
  const entry = {
    dn: generatedDN,
    attributes: Object.assign({
      objectclass: ['organizationalUnit', 'top'],
      ou: name,
      entryDN: dn,
    }, attrs),
  };
  return entry;
}

function makePersonEntry(dn, attrs) {
  // u.ldap = {
  //   dn: `mail=${mail}, ${depDN}`,
  //   attributes: {
  //     objectclass: ['inetOrgPerson', 'organizationalPerson', 'person', 'top'],
  //     uid: u.userid,
  //     title: u.position,
  //     mobileTelephoneNumber: u.mobile,
  //     cn: u.name,
  //     givenName: u.name.substr(1),
  //     sn: u.name.substr(0, 1),
  //     mail,
  //     userPassword: '123456',
  //   }
  // };
  const generatedDN = makeOrganizationUnitEntryDN(dn);
  const entry = {
    dn: generatedDN,
    attributes: Object.assign({
      objectclass: ['inetOrgPerson', 'organizationalPerson', 'person', 'top'],
      userPassword: ldapConfig.userPassword || Math.random().toString(36).substring(2, 15),
      // otpSecret: 'abcd',
      memberOf: [],
      entryDN: dn,
    }, attrs)
  };
  return entry;
}

function makeGroupEntry(dn, name, members, attrs = {}) {
    // dn: d.dn,
  // attributes: {
  //   objectclass: ['groupOfNames', 'top'],
  //   ou: d.name,
  // }
  const generatedDN = makeGroupEntryDN(dn);
  const entry = {
    dn: generatedDN,
    attributes: Object.assign({
      objectclass: ['groupOfNames', 'top'],
      cn: name,
      ou: name,
      member: members,
      memberOf: [],
      entryDN: dn,
    }, attrs),
  };
  return entry;
}

function getOrganizationEntry() {
  const entry = {
    dn: getOrganizationBaseDN(),
    attributes: {
      objectclass: ['organization', 'top'],
      ou: ldapConfig.organization,
    },
  };
  return entry;
}

function getPeopleBaseEntry() {
  const entry = {
    dn: getPeopleBaseDN(),
    attributes: {
      objectclass: ['organizationalUnit', 'top'],
      ou: 'People',
    },
  };
  return entry;
}

function getGroupsBaseEntry() {
  const entry = {
    dn: getGroupsBaseDN(),
    attributes: {
      objectclass: ['organizationalUnit', 'top'],
      ou: 'Groups',
    },
  };
  return entry;
}

function makeAdminEntry(attrs) {
  // {dn: 'cn=admin,'+rootDN, attributes: { objectclass: ['simpleSecurityObject', 'organizationalRole'], hasSubordinates: ['FALSE'] } },
  const entry = {
    dn: [ `cn=${attrs.commonName}`, getRootDN() ].join(','),
    attributes: { objectclass: ['simpleSecurityObject', 'organizationalRole'],
    hasSubordinates: ['FALSE'] },
  };
  return entry;
}

function getAdminEntries() {
  return ldapConfig.admins.map(cfg => {
    return makeAdminEntry(cfg);
  });
}

function getBaseEntries() {
  if (!cachedBaseEntries) {
    const rootDN = getRootDN();
    const rootEntry = {
      dn: rootDN,
      attributes: {
        objectclass: ['dcObject', 'organization', 'top'],
        dc: rootDN.split(',')[0].split('=')[1].trim(),
        o: ldapConfig.organization,
        hasSubordinates: ['TRUE'],
      }
    };

    cachedBaseEntries = [
      rootEntry,
      getOrganizationEntry(),
      getPeopleBaseEntry(),
      getGroupsBaseEntry(),
      ...getAdminEntries(),
    ];
  }

  return cachedBaseEntries;
}

function validateAdminPassword(username, password) {
  const [ user ] = ldapConfig.admins.filter(u => {
    return u.commonName == username;
  });
  if (user && user.password === password) {
    return true;
  }

  return false;
}


function validateAdminPermission(username, permission) {
  const [ user ] = ldapConfig.admins.filter(u => {
    return u.commonName == username;
  });
  if (user && user[permission]) {
    return true;
  }

  return false;
}

function addMemberToGroup(memberEntry, groupEntry) {
  if (groupEntry.attributes.member.indexOf(memberEntry.dn) < 0) {
    groupEntry.attributes.member.push(memberEntry.dn);
  }
  if (memberEntry.attributes.memberOf.indexOf(groupEntry.dn) < 0) {
    memberEntry.attributes.memberOf.push(groupEntry.dn);
  }
}


module.exports = {
  getRootDN,
  getOrganizationBaseDN,
  getAdminEntries,
  getBaseEntries,
  makeGroupEntry,
  makeOrganizationUnitEntry,
  makePersonEntry,
  validateAdminPassword,
  validateAdminPermission,
  addMemberToGroup,
};
