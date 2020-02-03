const crypto = require('crypto');

function validateUserPassword(secret, input) {
  if (secret.substr(0, 9) === '{SSHA256}') {
    secret = secret.substr(9);
    const secbin = Buffer.from(secret, 'base64');
    const userpw = secbin.subarray(0, secbin.length - 8).toString('hex');
    const salt = secbin.subarray(secbin.length - 8);
    const hash = crypto.createHash('sha256');
    hash.update(input);
    hash.update(salt);
    const inputpw = hash.digest('hex');
    // console.log('userpw', userpw);
    // console.log('inputpw', inputpw);
    return inputpw === userpw;

  } else {
    return secret === input;
  }
}

function storeUserPassword(input) {
  const hash = crypto.createHash('sha256');
  hash.update(input);
  const salt = Buffer.alloc(8);
  for (let i = 0; i < 8; ++i) {
    const b = Math.floor(Math.random() * 256);
    // console.log('salt byte', i, b);
    salt.writeUInt8(b, i);
  }
  // console.log('salt', salt.toString('hex'));
  hash.update(salt);
  const digest = hash.digest();
  const hashbin = Buffer.concat([ digest, salt ]);
  // console.log('pwhash', digest.toString('hex'));
  digest.write(salt.toString('hex'), 'hex');
  // console.log('pwhash /w salt', hashbin.toString('hex'));
  const pw = '{SSHA256}' + hashbin.toString('base64');
  return pw;
}

module.exports = {
  validateUserPassword,
  storeUserPassword,
};
