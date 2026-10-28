import express from 'express';
import type { AppConfig } from './config/env.js';
import { createLogger } from './shared/logger.js';
import { createHealthRouter } from './modules/health/health.routes.js';
import { createApiRouter } from './routes/index.js';
import { notFound } from './middlewares/not-found.js';
import { createErrorHandler } from './middlewares/error-handler.js';

export function createApp(config: AppConfig, logger = createLogger(config)) {
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const startedAt = performance.now();
    const path = req.path;
    res.on('finish', () => {
      logger.info(
        {
          method: req.method,
          path,
          status: res.statusCode,
          durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
        },
        'HTTP request',
      );
    });
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use('/health', createHealthRouter());
  app.use('/api/v1', createApiRouter());
  app.use(notFound);
  app.use(createErrorHandler(logger));
  return app;
}
