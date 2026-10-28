import { pino } from 'pino';
import type { AppConfig } from '../config/env.js';

export function createLogger(config: AppConfig) {
  return pino({
    level: config.logLevel,
    base: { service: 'task-manage-app-example' },
  });
}
