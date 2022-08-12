const axios = require("axios");
const log = require("log").get("wecom-provider");

const {
  makeGroupEntry,
  makePersonEntry,
  makeOrganizationUnitEntry,
  addMemberToGroup,
} = require("../utilities/ldap");
const { saveCacheToFile, loadCacheFromFile } = require("../utilities/cache");

let appKey = "";
let appSecret = "";
let accessToken = "";

let allLDAPUsers = [];
let allLDAPOrgUnits = [];
let allLDAPGroups = [];
let allLDAPEntries = [];

function api(path) {
  return `https://qyapi.weixin.qq.com/cgi-bin/${path}?access_token=${accessToken}`;
}

function parseName(name) {
  // 如果名字没有空格，以中文处理，第一个字为姓，其他为名
  // 如果有空格，以英文处理，最后一个单词为姓，其他为名
  let givenName = name.substring(1);
  let sn = name.substring(0, 1);
  if (name.indexOf(" ") > 0) {
    const parts = name.split(" ");
    sn = parts.pop();
    givenName = parts.join(" ");
  }

  return { givenName, sn };
}

async function weComGet(path, params) {
  const apiUrl = path.substring(0, 8) === "https://" ? path : api(path);
  const ret = await axios(apiUrl, { params }).catch((e) => {
    log.error("WeCom API error", e);
    return null;
  });

  if (ret && ret.data) {
    if (ret.data.errcode !== 0) {
      log.error("WeCom API error", ret.data);
      return null;
    } else {
      return ret.data;
    }
  } else {
    log.error("WeCom API error", ret);
  }

  return null;
}

async function getToken() {
  const token = await weComGet(
    `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${appKey}&corpsecret=${appSecret}`
  );
  if (token && token.access_token) {
    accessToken = token.access_token;
  } else {
    log.error("Get access token failed", token);
  }
}

/**
 * https://developer.work.weixin.qq.com/document/path/90208
 * @returns {Promise<any[]|*[]>}
 */
async function fetchAllDepartments() {
  let allDeps = loadCacheFromFile("wecom_groups.json");
  if (!allDeps) {
    const deps = await weComGet("department/list");

    if (!deps) {
      return [];
    }
    log.info("Got", deps.department.length, "departments");

    const depsMap = {};
    deps.department.forEach((d) => {
      d.name = d.name.replace(/ \/ /g, " - ").replace(/\//g, "&").trim();
      depsMap[d.id] = d;
    });

    allDeps = Object.values(depsMap);
    const allDepNames = {};
    allDeps.forEach((v) => {
      let name = v.name;
      let idx = 2;
      while (allDepNames[name]) {
        name = v.name + idx;
        idx++;
      }
      allDepNames[name] = 1;
      v.name = name;
    });

    saveCacheToFile("wecom_groups.json", allDeps);
  }

  const depsMap = {};
  allDeps.forEach((d) => {
    depsMap[d.id] = d;
  });
  allDeps.forEach((d) => {
    let obj = d;
    let dn = [`ou=${obj.name}`];
    while (obj.parentid) {
      obj = depsMap[obj.parentid];
      dn.push(`ou=${obj.name}`);
    }
    d.dn = dn.join(",");
  });

  return allDeps;
}

/**
 * 1）2022年6月20日后新创建的自建应用，成员敏感信息需要成员在登录应用时自主授权，通过「获取访问用户敏感信息」接口获取。
 * 2）2022年6月20日前已经创建的自建应用，可继续调用通讯录接口获取员工敏感信息。
 * ref: https://developer.work.weixin.qq.com/document/path/96079
 *
 * https://developer.work.weixin.qq.com/document/path/90201
 * @param department
 * @returns {Promise<*[]>}
 */
async function fetchDepartmentUsers(department) {
  log.info("get users for department", department);
  const userList = [];
  const users = await weComGet("user/list", {
    department_id: department.id,
  });

  userList.push(...users.userlist);

  userList.forEach((user) => {
    user.firstDepartment = department;
    user.orgEmail = user.biz_mail;
    user.active = user.status === 1;
  });
  return userList;
}

async function fetchAllUsers(departments) {
  let allUsers = loadCacheFromFile("wecom_users.json");
  if (!allUsers && departments.length > 0) {
    allUsers = [];
    for (let i = 0; i < departments.length; ++i) {
      allUsers.push(...(await fetchDepartmentUsers(departments[i])));
    }
    saveCacheToFile("wecom_users.json", allUsers);
  }

  return allUsers;
}

async function setupProvider(config) {
  appKey = config.appKey;
  appSecret = config.appSecret;
  await reloadFromWeComServer();
}

async function reloadFromWeComServer() {
  await getToken();

  // 获取所有部门
  let allDepartments = await fetchAllDepartments();

  // 映射到 organizationalUnit
  const allDepartmentsMap = {};
  allLDAPOrgUnits = allDepartments.map((d) => {
    allDepartmentsMap[d.id] = d;
    return makeOrganizationUnitEntry(d.dn, d.name, {
      groupid: d.id,
    });
  });

  // 映射到 groupOfNames
  const allLDAPGroupsMap = [];
  allLDAPGroups = allDepartments.map((d) => {
    const g = makeGroupEntry(d.dn, d.name, [], {
      groupid: d.id,
    });
    allLDAPGroupsMap[d.id] = g;
    return g;
  });

  Object.values(allDepartmentsMap).forEach((dep) => {
    if (dep.parentid) {
      const parentDep = allDepartmentsMap[dep.parentid];
      addMemberToGroup(
        allLDAPGroupsMap[dep.id],
        allLDAPGroupsMap[parentDep.id]
      );
    }
  });

  // 按部门获取所有员工
  const allUsers = await fetchAllUsers(allDepartments);

  const allUsersMap = {};
  allLDAPUsers = allUsers
    .filter((u) => {
      if (!allUsersMap[u.userid]) {
        allUsersMap[u.userid] = 1;
        return u.active;
      }
      return true;
    })
    .filter((u) => {
      if (!(u.orgEmail || u.email)) {
        console.log("Incorrect user missing email", u);
        return false;
      }
      return true;
    })
    .map((u) => {
      const mail = (u.orgEmail || u.email).toLowerCase();
      const dn = `mail=${mail},${u.firstDepartment.dn}`;

      const { givenName, sn } = parseName(u.name);

      // 映射到 iNetOrgPerson
      const personEntry = makePersonEntry(dn, {
        uid: u.userid.toLowerCase(),
        title: u.position,
        mobileTelephoneNumber: u.mobile,
        cn: u.name,
        givenName,
        sn,
        mail,
        avatarurl: u.avatar,
      });

      // 将用户加到组里
      u.department.forEach((depId) => {
        let parentDep = allDepartmentsMap[depId];
        // allLDAPGroupsMap[parentDep.id].attributes.member.push(personEntry.dn);
        while (parentDep && parentDep.id) {
          addMemberToGroup(personEntry, allLDAPGroupsMap[parentDep.id]);
          // console.log('add member', personEntry.attributes.cn, 'to', allLDAPGroupsMap[parentDep.id].attributes.cn);
          parentDep = allDepartmentsMap[parentDep.parentid];
        }
      });

      return personEntry;
    });

  allLDAPEntries = [].concat(allLDAPGroups, allLDAPOrgUnits, allLDAPUsers);
}

function getAllLDAPEntries() {
  return allLDAPEntries;
}

function reloadEntriesFromProvider() {
  log.info("Reload entries from WeCom");
  reloadFromWeComServer()
      .then(() => console.info("Reloaded entries from WeCom"))
      .catch((err) => console.error("Error reloading entries from WeCom", err));
}

module.exports = {
  setupProvider,
  getAllLDAPEntries,
  reloadEntriesFromProvider,
};
