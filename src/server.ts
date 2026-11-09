import { createShutdown } from './shutdown.js';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './shared/logger.js';
import { createNotificationClient } from './helper/rita-http/notification-client.js';
function main() {
  const config = loadConfig(),
    logger = createLogger(config),
    client = createNotificationClient(config);
  const server = createApp(config, logger, client).listen(config.port, () =>
    logger.info({ port: config.port }, 'HTTP server listening'),
  );
  server.on('error', () => {
    logger.fatal('HTTP server failed');
    process.exitCode = 1;
    void client.stop();
  });
  const shutdown = createShutdown(server, client, logger, (code) => {
    process.exitCode = code;
  });
  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}
try {
  main();
} catch {
  console.error('Application startup failed. Check environment configuration.');
  process.exitCode = 1;
}
