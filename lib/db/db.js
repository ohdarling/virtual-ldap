const {
  type: dbType
} = require('../config').database;

const {
  dbSelect,
  dbInsert,
  dbUpdate,
} = require('./' + dbType);

const TABLE_USER_CREDENTIALS = 'user_credentials';

async function getDBRecordForUserId(uid) {
  const [ record ] = await dbSelect(TABLE_USER_CREDENTIALS, { uid });
  if (record) {
    return record;
  }

  return {
    userid: uid,
    password: Math.random().toString(36).substring(2, 15),
  };
}


async function saveDBRecordForUserId(uid, data) {
  const [ record ] = await await dbSelect(TABLE_USER_CREDENTIALS, { uid });
  if (record) {
    await dbUpdate(TABLE_USER_CREDENTIALS, data, { uid });
  } else {
    await dbInsert(TABLE_USER_CREDENTIALS, Object.assign({ uid }, data));
  }
}

module.exports = {
  getDBRecordForUserId,
  saveDBRecordForUserId,
};
