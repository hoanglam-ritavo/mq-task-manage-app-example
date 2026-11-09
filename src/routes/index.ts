import { Router } from 'express';
import { createProfileReadRouter } from '../modules/employee-profile/read.routes.js';
import type { ProfileStore } from '../modules/employee-profile/webhook.js';
import { createNotificationExampleRouter } from '../modules/notification-example/index.js';
import type { NotificationClient } from '../helper/rita-http/notification-client.js';
export function createApiRouter(
  client: NotificationClient,
  store: ProfileStore,
) {
  const router = Router();
  router.use(
    '/examples/notifications',
    createNotificationExampleRouter(client),
  );
  router.use('/employee-profiles', createProfileReadRouter(store));
  return router;
}
