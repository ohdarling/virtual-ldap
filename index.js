const server = require("./lib");

if (require.main === module) {
  server.setupVirtualLDAPServer(require("./config.example"));
  server.runVirtualLDAPServer();
} else {
  module.exports = server;
}
