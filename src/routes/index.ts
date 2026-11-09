import { Router } from 'express';
import { createNotificationExampleRouter } from '../modules/notification-example/index.js';
import type { NotificationClient } from '../helper/rita-http/notification-client.js';
export function createApiRouter(client: NotificationClient) {
  const router = Router();
  router.use(
    '/examples/notifications',
    createNotificationExampleRouter(client),
  );
  return router;
}
