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

  // if can not find record from database, return null
  return {
    userid: uid,
    password: null,
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
