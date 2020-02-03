require('log-node')();

const serverConfig = {};

function setupVirtualLDAPServer(config) {
  Object.assign(serverConfig, config);
}

function runVirtualLDAPServer() {
  require("./server").runVirtualLDAPServer();
}

module.exports = {
  serverConfig,
  setupVirtualLDAPServer,
  runVirtualLDAPServer,
};
