'use strict';

const { config } = require('./src/config');
const { ensureSeed, cleanupExpiredSessions, db } = require('./src/db');
const { createApp } = require('./src/app');

async function main() {
  await ensureSeed();
  cleanupExpiredSessions();

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    const address = server.address();
    const port = address && typeof address === 'object' ? address.port : config.port;
    const shownHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
    console.log('');
    console.log('  OpenBBS is ready.');
    console.log(`  Local:   http://${shownHost}:${port}`);
    console.log(`  Site:    ${config.siteUrl}`);
    console.log(`  Admin:   ${config.siteUrl}/admin`);
    console.log(`  Node:    ${process.version}  |  DB: ${config.databasePath}`);
    console.log('');
  });

  server.keepAliveTimeout = 65 * 1000;
  server.headersTimeout = 66 * 1000;

  const sessionTimer = setInterval(() => {
    try {
      cleanupExpiredSessions();
    } catch (error) {
      console.error('[openbbs] session cleanup failed:', error);
    }
  }, 60 * 60 * 1000);
  sessionTimer.unref();

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[openbbs] received ${signal}, shutting down...`);
    const force = setTimeout(() => {
      console.error('[openbbs] forced shutdown');
      process.exit(1);
    }, 10000);
    force.unref();
    server.close(() => {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      clearTimeout(force);
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[openbbs] failed to start:', error);
  process.exit(1);
});
