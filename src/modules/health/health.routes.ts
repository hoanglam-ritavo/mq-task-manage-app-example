import { Router } from 'express';
import { healthController } from './health.controller.js';

export function createHealthRouter() {
  const router = Router();
  router.get('/', healthController);
  return router;
}
