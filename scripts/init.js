'use strict';

/**
 * Initialise the database, create the first administrator and seed content.
 * Usage: npm run init
 */
const { config } = require('../src/config');
const { ensureSeed, getStats, ADMIN_CREDENTIALS_FILE, db } = require('../src/db');
const fs = require('node:fs');

(async () => {
  const result = await ensureSeed();
  const stats = getStats();
  console.log('');
  console.log('  OpenBBS initialisation complete');
  console.log(`  Database: ${config.databasePath}`);
  console.log(`  Users: ${stats.users}  Topics: ${stats.topics}  Posts: ${stats.posts}`);
  console.log(`  Site URL: ${config.siteUrl}`);
  if (result && result.created) {
    console.log(`  Administrator: ${result.username}`);
    if (result.generated && fs.existsSync(ADMIN_CREDENTIALS_FILE)) {
      console.log(`  Initial password: see ${ADMIN_CREDENTIALS_FILE}`);
    }
  } else {
    console.log('  Existing installation detected — nothing was overwritten.');
  }
  console.log('');
  db.close();
})().catch((error) => {
  console.error('[openbbs] initialisation failed:', error);
  process.exit(1);
});
