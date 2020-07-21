const axios = require('axios');
const log = require('log').get('dingtalk-provider');
const pinyin = require('pinyin');

const {
  makeGroupEntry,
  makePersonEntry,
  makeOrganizationUnitEntry,
  addMemberToGroup,
} = require('../utilities/ldap');
const {
  saveCacheToFile,
  loadCacheFromFile,
} = require('../utilities/cache');

let appKey = '';
let appSecret = '';
let accessToken = '';

let allLDAPUsers = [];
let allLDAPOrgUnits = [];
let allLDAPGroups = [];
let allLDAPEntries = [];

function api(path) {
  return `https://oapi.dingtalk.com/${path}?access_token=${accessToken}`;
}

function parseName(name) {
    // 如果名字没有空格，以中文处理，第一个字为姓，其他为名
    // 如果有空格，以英文处理，最后一个单词为姓，其他为名
    let givenName = name.substr(1);
    let sn = name.substr(0, 1);
    if (name.indexOf(' ') > 0) {
      const parts = name.split(' ');
      sn = parts.pop();
      givenName = parts.join(' ');
    }
    
    return { givenName, sn };
}

async function ddGet(path, params) {
  const apiUrl = path.substr(0, 8) === 'https://' ? path : api(path);
  const ret = await axios(apiUrl, { params }).catch(e => {
    log.error("Dingtalk API error", e);
    return null;
  });

  if (ret && ret.data) {
    if (ret.data.errcode != 0) {
      log.error('Dingtalk API error', ret.data);
      return null;
    } else {
      return ret.data;
    }
  } else {
    log.error('Dingtalk API error', ret);
  }

  return null;
}

async function getToken() {
  const token = await ddGet(`https://oapi.dingtalk.com/gettoken?appkey=${appKey}&appsecret=${appSecret}`);
  if (token && token.access_token) {
    accessToken = token.access_token;
  } else {
    log.error('Get access token failed', token);
  }
}

/*
{
  '100560627': {
    ext: '{"faceCount":"92"}',
    createDeptGroup: true,
    name: 'Product & Dev / 产品技术',
    id: 100560627,
    autoAddUser: true,
    parentid: 111865024,
    dn: 'ou=Product & Dev / 产品技术, ou=全员, o=LongBridge, dc=longbridge-inc, dc=com'
  },
  */
async function fetchAllDepartments() {
  let allDeps = loadCacheFromFile('dingtalk_groups.json');
  if (!allDeps) {
    const deps = await ddGet('department/list', {
      fetch_child: true,
      id: 1,
    });

    if (!deps) {
      return [];
    }
    log.info('Got', deps.department.length, 'departments');

    const depsMap = {
      '1': {
        name: 'Staff',
        id: 1,
        parentid: null,
      },
    };
    deps.department.forEach(d => {
      d.name = d.name.replace(/ \/ /g, ' - ').replace(/\//g, '&').trim();
      depsMap[d.id] = d;
    });

    allDeps = Object.values(depsMap);
    const allDepNames = {};
    allDeps.forEach(v => {
      let name = v.name;
      let idx = 2;
      while (allDepNames[name]) {
        name = v.name + idx;
        idx++;
      }
      allDepNames[name] = 1;
      v.name = name;
    })

    saveCacheToFile('dingtalk_groups.json', allDeps);
  }

  const depsMap = {};
  allDeps.forEach(d => { depsMap[d.id] = d; });
  allDeps.forEach(d => {
    let obj = d;
    let dn = [ `ou=${obj.name}` ];
    while (obj.parentid) {
      obj = depsMap[obj.parentid];
      dn.push(`ou=${obj.name}`);
    }
    d.dn = dn.join(',');
  });

  return allDeps;
}

/*
{
  unionid: 'DLB1ru0iiZ6rB8z4juaJwWAiEiE',
  openId: 'DLB1ru0iiZ6rB8z4juaJwWAiEiE',
  remark: '',
  userid: '0156594846753096123',
  isBoss: false,
  hiredDate: 1539532800000,
  tel: '',
  department: [ 109334341 ],
  workPlace: '杭州',
  email: '',
  order: 177917621779460500,
  isLeader: false,
  mobile: '18815286506',
  active: true,
  isAdmin: false,
  avatar: 'https://static-legacy.dingtalk.com/media/lADPACOG819UTLzNAu7NAu4_750_750.jpg',
  isHide: false,
  orgEmail: 'ke.xu@longbridge.sg',
  jobnumber: '0049',
  name: '徐克',
  extattr: {},
  stateCode: '86',
  position: 'iOS开发工程师'
}
*/
async function fetchDepartmentUsers(department) {
  log.info('get users for department', department);
  const userlist = [];
  let hasMore = true;
  let offset = 0;

  while (hasMore) {
    const users = await ddGet('user/listbypage', {
      department_id: department.id,
      offset,
      size: 100,
      order: 'entry_asc',
    });
    userlist.push(...users.userlist);
    hasMore = users.hasMore;
  }

  userlist.forEach(u => {
    u.firstDepartment = department;
  });

  return userlist;
}

async function fetchAllUsers(departments) {
  let allUsers = loadCacheFromFile('dingtalk_users.json');
  if (!allUsers && departments.length > 0) {
    allUsers = [];
    for (let i = 0; i < departments.length; ++i) {
      allUsers.push(...(await fetchDepartmentUsers(departments[i])));
    }
    allUsers = allUsers.filter(u=> {return (u.orgEmail || u.email)});
    saveCacheToFile('dingtalk_users.json',  allUsers);
  }

  return allUsers;
}

async function setupProvider(config) {
  appKey = config.appKey;
  appSecret = config.appSecret;
  await reloadFromDingtalkServer();
}

async function reloadFromDingtalkServer() {
  await getToken();

  // 获取所有部门
  let allDepartments = await fetchAllDepartments();

  // 映射到 organizationalUnit
  const allDepartmentsMap = {};
  allLDAPOrgUnits = allDepartments.map(d => {
    allDepartmentsMap[d.id] = d;
    return makeOrganizationUnitEntry(d.dn, d.name, {
      groupid: d.id,
    });
  });

  // 映射到 groupOfNames
  const allLDAPGroupsMap = [];
  allLDAPGroups = allDepartments.map(d => {
    const g = makeGroupEntry(d.dn, d.name, [], {
      groupid: d.id,
    });
    allLDAPGroupsMap[d.id] = g;
    return g;
  });

  Object.values(allDepartmentsMap).forEach(dep => {
    if (dep.parentid) {
      const parentDep = allDepartmentsMap[dep.parentid];
      addMemberToGroup(allLDAPGroupsMap[dep.id], allLDAPGroupsMap[parentDep.id]);
    }
  })

  // 按部门获取所有员工
  const allUsers = await fetchAllUsers(allDepartments);

  
  const allUsersMap = {};
  allLDAPUsers = allUsers.filter(u => {

    if (!allUsersMap[u.userid]) {
      allUsersMap[u.userid] = 1;
      return u.active;
    }
    return false;
  }).filter(u => {
    if (!(u.orgEmail || u.email)) {
      log.warn('Incorrect user missing email', u);
      return false;
    }
    return true;
  }).map(u => {
    const mail = (u.orgEmail || u.email).toLowerCase();
    
    const dn = `mail=${mail},${u.firstDepartment.dn}`;

    const { givenName, sn } = parseName(u.name);
    const  py = u.remark || (pinyin(u.name,{ style: pinyin.STYLE_NORMAL }).join(''));

    // 映射到 iNetOrgPerson
    const personEntry = makePersonEntry(dn, {
      uid: u.userid,
      title: u.position,
      mobileTelephoneNumber: u.mobile,
      pinyin: py,
      cn: u.name,
      givenName,
      sn,
      mail,
      avatarurl: u.avatar,
      remark: u.remark
    });

    // 将用户加到组里
    u.department.forEach(depId => {
      let parentDep = allDepartmentsMap[depId];
      // allLDAPGroupsMap[parentDep.id].attributes.member.push(personEntry.dn);
      while (parentDep && parentDep.id) {
        addMemberToGroup(personEntry, allLDAPGroupsMap[parentDep.id]);
        // console.log('add member', personEntry.attributes.cn, 'to', allLDAPGroupsMap[parentDep.id].attributes.cn);
        parentDep = allDepartmentsMap[parentDep.parentid];
      }
    })

    return personEntry;
  });

  allLDAPEntries = [].concat(allLDAPGroups, allLDAPOrgUnits, allLDAPUsers);
}

function getAllLDAPEntries() {
  return allLDAPEntries;
}

function reloadEntriesFromProvider() {
  log.info('Reload entries from Dingtalk');
  reloadFromDingtalkServer();
}


// if (0) {
//   (async function() {
//     await setupProvider(require('../config').provider);
//     log.info(getAllLDAPEntries());
//   })();
//   setTimeout(() => {}, 0);
// }

module.exports = {
  setupProvider,
  getAllLDAPEntries,
  reloadEntriesFromProvider,
};
