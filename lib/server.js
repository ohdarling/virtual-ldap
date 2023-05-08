const ldap = require('ldapjs');
const log = require('log').get('server');
const CronJob = require('cron').CronJob;

const {
  ldap: ldapConfig,
} = require('./config');
const { parseDN, parseFilter } = ldap;
const {
  validateUserPassword,
  storeUserPassword,
} = require('./utilities/password');
const {
  getBaseEntries,
  getRootDN,
  getOrganizationBaseDN,
  validateAdminPassword,
  validateAdminPermission,
} = require('./utilities/ldap');
const {
  createProvider,
  getProviderLDAPEntries,
  reloadEntriesFromProvider,
} = require('./utilities/provider');
const {
  getLDAPCustomGroupEntries,
} = require('./utilities/custom_groups');
const {
  getDBRecordForUserId,
  saveDBRecordForUserId,
} = require('./db/db');

let server = ldap.createServer();

// equalsDN for comparing dn in case-insensitive
function equalsDN(a, b) {
  a = parseDN((a instanceof String ? a : a.toString()).toLowerCase());
  b = parseDN((b instanceof String ? b : b.toString()).toLowerCase());
  return a.equals(b);
}

function getPersonMatchedDN(reqDN) {
  const personFilter = parseFilter('(objectclass=inetOrgPerson)');
  const [ matchedUser ] = getProviderLDAPEntries().filter(entry => {
    return equalsDN(reqDN, entry.dn) && personFilter.matches(entry.attributes);
  });
  return matchedUser;
}

function authorize(req, res, next) {
  log.debug('===> authorize info');
  log.debug('req type', req.constructor.name);
  log.debug('reqDN', (req.baseObject || '').toString());
  log.debug('bindDN', req.connection.ldap.bindDN.toString());
  log.debug('====');
  const bindDN = req.connection.ldap.bindDN;
  const rootDN = parseDN(getRootDN());

  // person can search itself
  if (req instanceof ldap.SearchRequest) {
    if (equalsDN(bindDN, req.baseObject)) {
      return next();
    }
  }

  // root admin can do everything
  if (equalsDN(bindDN.parent(), rootDN)) {
    return next();
  }

  return next(new ldap.InsufficientAccessRightsError());
}


// DSE
server.search('', authorize, function(req, res, next) {
	var baseObject = {
		dn: '',
		structuralObjectClass: 'OpenLDAProotDSE',
		configContext: 'cn=config',
		attributes: {
			objectclass: ['top', 'OpenLDAProotDSE'],
			namingContexts: [ getRootDN() ],
			supportedLDAPVersion: ['3'],
			subschemaSubentry:['cn=Subschema']
		}
	};
	log.info("scope "+req.scope+" filter "+req.filter+" baseObject "+req.baseObject);
	if('base' == req.scope
		&& '(objectclass=*)' == req.filter.toString()
		&& req.baseObject == ''){
		res.send(baseObject);
	}

	//log.info('scope: ' + req.scope);
	//log.info('filter: ' + req.filter.toString());
	//log.info('attributes: ' + req.attributes);
	res.end();
	return next();
});


server.search('cn=Subschema', authorize, function(req, res, next) {
	var schema = {
		dn: 'cn=Subschema',
		attributes: {
			objectclass: ['top', 'subentry', 'subschema', 'extensibleObject'],
			cn: ['Subschema']
		}
	};
	res.send(schema);
	res.end();
	return next();
});


server.search(getRootDN(), authorize, (req, res, next) => {
  log.info("search req scope " + req.scope + " filter " + req.filter + " baseObject " + req.baseObject);
  // console.log('sizeLimit', req.sizeLimit, 'timeLimit', req.timeLimit);
  const reqDN = parseDN(req.baseObject.toString().toLowerCase());

  const comparators = {
    'one': (objDN) => {
      return equalsDN(reqDN, objDN.parent());
    },
    'sub': (objDN) => {
      return equalsDN(reqDN, objDN) || reqDN.parentOf(objDN);
    },
    'base': (objDN) => {
      return equalsDN(reqDN, objDN);
    },
  }

  const comparator = comparators[req.scope];
  if (comparator) {
    [
      ...getBaseEntries(),
      ...getProviderLDAPEntries(),
      ...getLDAPCustomGroupEntries(),
    ].filter(entry => {
      return comparator(parseDN(entry.dn.toLowerCase())) && req.filter.matches(entry.attributes);
    }).forEach(entry => {
      log.debug('send entry', entry.dn);
      res.send(entry);
    });
  }

  res.end();
  return next();
});

server.modify(getOrganizationBaseDN(), authorize, async (req, res, next) => {
//   DN: uid=zhangsan@alibaba-inc.com, ou=HR, o=LongBridge, dc=longbridge-inc, dc=com
// changes:
//   operation: replace
//   modification: {"type":"userpassword","vals":["{SMD5}jFCfdWsVs6GF/1CO2+2ZBwIevCudAH7v"]}
  const reqDN = parseDN(req.dn.toString().toLowerCase());
  const username = req.connection.ldap.bindDN.rdns[0].attrs.cn.value;
  log.debug('modify req', reqDN.toString());
  if (!validateAdminPermission(username, 'canModifyEntry')) {
    return next(new ldap.InsufficientAccessRightsError());
  }

  const matchedUser = getPersonMatchedDN(reqDN);
  // console.log('modify user', matchedUser);
  if (matchedUser) {
    // console.log('DN: ' + req.dn.toString());
    // console.log('changes:');
    for (let i = 0; i < req.changes.length; ++i) {
      const c = req.changes[i];
      // console.log('  operation: ' + c.operation);
      // console.log('  modification: ' + c.modification.toString());
      if (c.operation === 'replace' && c.modification.type === 'userpassword') {
        let newpass = c.modification.vals[0];
        if (newpass.substr(0, 9) !== '{SSHA256}') {
          newpass = storeUserPassword(newpass);
        }
        await saveDBRecordForUserId(matchedUser.attributes.uid, {
          password: newpass,
        });
        // console.log('modify user', matchedUser.attributes.uid, 'pass to', newpass);
      }

      if (c.operation === 'replace' && c.modification.type === 'otpsecret') {
        let newsecret = c.modification.vals[0];
        // console.log('modify user', matchedUser.dn, 'otp secret to', newsecret);
        await saveDBRecordForUserId(matchedUser.attributes.uid, {
          otpsecret: newsecret,
        });
      }
    }
  }
  res.end();
  return next();
});

server.bind(getRootDN(), async (req, res, next) => {
  const reqDN = parseDN(req.dn.toString().toLowerCase());
  log.debug('bind req', reqDN.toString())
  if (parseDN(getRootDN().toLowerCase()).equals(reqDN.parent())) {
    // admins
    const username = reqDN.rdns[0].attrs.cn.value;
    if (validateAdminPassword(username, req.credentials)) {
      res.end();
      return next();
    } else {
      return next(new ldap.InvalidCredentialsError());
    }

  } else if (parseDN(getOrganizationBaseDN().toLowerCase()).parentOf(reqDN)) {
    // users
    const matchedUser = getPersonMatchedDN(reqDN);
    if (matchedUser) {
      log.debug('Found user:', matchedUser)
      const record = await getDBRecordForUserId(matchedUser.attributes.uid);
      if(! record['password']) {
          log.info('Password in database is null, use ldap value, user is', reqDN)
          record['password'] = matchedUser['attributes']['userPassword']
      }
      log.debug('Ldap compare value is', record)
      log.debug('Request credentials is', req.credentials)
      if (record && validateUserPassword(record.password, req.credentials)) {
        res.end();
        return next();
      } else {
        log.debug('password failed');
        return next(new ldap.InvalidCredentialsError());
      }
    } else {
      log.warning('user is not found:', reqDN);
      return next(new ldap.InvalidCredentialsError());
    }
  }

  return next(new ldap.InsufficientAccessRightsError());
});

function runVirtualLDAPServer() {
  server.listen(ldapConfig.listenPort, async function() {
    await createProvider();
    log.info('virtual-ldap listening at ' + server.url);
  });

  // reload data from server every hour
  new CronJob('0 0 * * * *', () => {
    reloadEntriesFromProvider();
  }, null, true, 'Asia/Shanghai').start();
}

module.exports = {
  runVirtualLDAPServer,
};
