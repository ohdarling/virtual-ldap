const server = require("./lib");

if (require.main === module) {
  server.setupVirtualLDAPServer(require("./config"));
  server.runVirtualLDAPServer();
} else {
  module.exports = server;
}
