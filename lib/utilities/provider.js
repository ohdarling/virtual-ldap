const {
  provider: providerConfig,
} = require('../config');
const log = require('log').get('provider');

let provider = null;

async function createProvider() {
  if (!provider) {
    const name = providerConfig.name;
    log.info('Setting up provider', name);
    provider = require('../providers/' + name);
    await provider.setupProvider(providerConfig);
    log.info('Done');
  }

  return provider;
};

function getProviderLDAPEntries() {
  if (provider) {
    return provider.getAllLDAPEntries();
  }

  return [];
}

function reloadEntriesFromProvider() {
  if (provider) {
    log.info('Reload entries from provider');
    provider.reloadEntriesFromProvider();
  }
}

module.exports = {
  createProvider,
  getProviderLDAPEntries,
  reloadEntriesFromProvider,
};
