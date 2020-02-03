const path = require('path');
const fs = require('fs');
const log = require('log').get('cache');

function getCachePath(name) {
  const folder = path.join(__dirname, '..', '..', 'cache');
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder);
  }
  const p = path.resolve(path.join(folder, name));
  return p
}

function saveCacheToFile(name, obj, expires = 3600) {
  const p = getCachePath(name);
  const data = {
    expires: new Date((new Date() * 1 + expires * 1000)).toISOString(),
    data: obj,
  };
  fs.writeFileSync(p, JSON.stringify(data), { encoding: 'utf8' });
}

function loadCacheFromFile(name) {
  const p = getCachePath(name);
  let data = null;
  if (fs.existsSync(p)) {
    const content = fs.readFileSync(p, { encoding: 'utf8' });
    try {
      const obj = JSON.parse(content);
      if (obj && obj.data && obj.expires) {
        const now = new Date() * 1;
        const expires = new Date(obj.expires) * 1;
        if (now < expires) {
          data = obj.data;
        }
      }
    } catch (e) {
      log.warn('Invalid cache for', name);
    }
  }
  return data;
}

module.exports = {
  saveCacheToFile,
  loadCacheFromFile,
};
