import { registerEmployeeProfileConsumer } from './modules/employee-profile/index.js';
import { createRabbitMq } from './helper/rabbitmq/index.js';
import { createShutdown } from './shutdown.js';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './shared/logger.js';

function main() {
  const config = loadConfig();
  const logger = createLogger(config);
  const messaging = createRabbitMq(config.rabbitmq, logger);
  if (config.rabbitmq.enabled) registerEmployeeProfileConsumer(messaging);
  messaging.start();
  const server = createApp(config, logger, messaging).listen(
    config.port,
    () => {
      logger.info({ port: config.port }, 'HTTP server listening');
    },
  );

  server.on('error', () => {
    logger.fatal('HTTP server failed');
    process.exitCode = 1;
    void messaging.stop();
  });

  const shutdown = createShutdown(server, messaging, logger, (code) => {
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
  // Avoid exposing environment values or unexpected startup error details.
  console.error('Application startup failed. Check environment configuration.');
  process.exitCode = 1;
}
