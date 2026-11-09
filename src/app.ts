import express from 'express';
import type { AppConfig } from './config/env.js';
import { createLogger } from './shared/logger.js';
import { demoAuth } from './shared/demo-auth.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createApiRouter } from './routes/index.js';
import { notFound } from './middlewares/not-found.js';
import { createErrorHandler } from './middlewares/error-handler.js';
import { createDocumentationRouter } from './modules/documentation/index.js';
import {
  createProfileWebhookRouter,
  ProfileStore,
} from './modules/employee-profile/webhook.js';
import {
  createNotificationClient,
  type NotificationClient,
} from './helper/rita-http/notification-client.js';
export function createApp(
  config: AppConfig,
  logger = createLogger(config),
  client: NotificationClient = createNotificationClient(config),
  store = new ProfileStore(),
) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const start = performance.now();
    const route = req.path.toLowerCase();
    res.on('finish', () =>
      logger.info(
        {
          method: req.method,
          path:
            route === '/health'
              ? '/health'
              : route.startsWith('/api/v1/examples/notifications')
                ? '/api/v1/examples/notifications/*'
                : route.startsWith('/api/v1/webhooks/rita-id/employee-profile')
                  ? '/api/v1/webhooks/rita-id/employee-profile'
                  : '/unmatched',
          status: res.statusCode,
          durationMs: Math.round(performance.now() - start),
        },
        'HTTP request',
      ),
    );
    next();
  });
  app.use(
    '/api/v1/webhooks/rita-id/employee-profile',
    createProfileWebhookRouter(config.rita.webhookSecret, logger, store),
  );
  app.use('/api/v1/examples/notifications', demoAuth(config.demoApiToken));
  app.use(express.json({ limit: '1mb' }));
  app.use('/health', createHealthRouter());
  app.use('/api/v1', createApiRouter(client));
  app.use(createDocumentationRouter());
  app.use(notFound);
  app.use(createErrorHandler(logger));
  return app;
}
