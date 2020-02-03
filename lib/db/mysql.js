const mysql = require('mysql2');

const {
  database: dbConfig,
} = require('../config');

let dbConnected = false;
let dbPool = null;

async function connect() {
  if (!dbConnected) {
    const opts = Object.assign({}, dbConfig);
    delete opts.type;
    dbPool = mysql.createPool(opts).promise();
    dbConnected = true;
  }
}

async function dbQuery(sql, params) {
  connect();
  const [ rows, fields ] = await dbPool.query(sql, params);
  return rows;
}

async function dbSelect(table, params) {
  const fields = Object.keys(params);
  const values = fields.map(k => params[k]);
  const sql = `SELECT * FROM ${table} WHERE ${fields.map(k => `${k}=?`).join(' AND ')}`;
  return dbQuery(sql, values);
}

async function dbUpdate(table, params, conditions) {
  const fields = Object.keys(params);
  const values = fields.map(k => params[k]);
  let conditionSQL = '';
  if (conditions) {
    const cfields = Object.keys(conditions);
    const cvalues = cfields.map(k => conditions[k]);
    conditionSQL = ` WHERE ${cfields.map(k => `${k}=?`).join(' AND ')}`;
    values.push(...cvalues);
  }
  const sql = `UPDATE ${table} SET ${fields.map(k => `${k}=?`).join(', ')} ${conditionSQL}`;
  return dbQuery(sql, values);
}

async function dbInsert(table, params) {
  const fields = Object.keys(params);
  const values = fields.map(k => params[k]);
  const sql = `INSERT INTO ${table} (${fields.join(', ')}) VALUES (${fields.map(k => '?').join(', ')})`;
  return dbQuery(sql, values);
}

async function dbDelete(table, conditions) {
  const values = [];
  let conditionSQL = '';
  if (conditions) {
    const cfields = Object.keys(conditions);
    const cvalues = fields.map(k => conditions[k]);
    conditionSQL = ` WHERE ${cfields.map(k => `${k}=?`).join(' AND ')}`;
    values.push(...cvalues);
  }
  const sql = `DELETE FROM ${table} ${conditionSQL}`
  return dbQuery(sql, values);
}

module.exports = {
  dbQuery,
  dbSelect,
  dbUpdate,
  dbInsert,
  dbDelete,
};
