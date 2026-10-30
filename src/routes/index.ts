import {
  createNotificationExampleRouter,
  type NotificationPublisher,
} from '../modules/notification-example/index.js';
import { Router } from 'express';

export function createApiRouter(publisher?: NotificationPublisher) {
  const router = Router();
  router.use(
    '/examples/notifications',
    createNotificationExampleRouter(publisher),
  );
  return router;
}
