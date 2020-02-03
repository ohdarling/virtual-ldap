const table = {};

async function dbSelect(table, { uid }) {
  return [ table[uid] ];
}

async function dbUpdate(table, params, { uid }) {
  table[uid] = Object.assign({}, table[uid] || {}, params);
}

async function dbInsert(table, params) {
  table[params.uid] = params;
}

module.exports = {
  dbSelect,
  dbUpdate,
  dbInsert,
};
