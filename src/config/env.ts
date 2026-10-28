import { isIP } from 'node:net';
function isRabbitHost(value: string): boolean {
  if (isIP(value)) return true;
  return (
    value.length <= 253 &&
    value
      .split('.')
      .every((label) =>
        /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label),
      )
  );
}
import type { RabbitMqConfig } from '../helper/rabbitmq/config.js';
import dotenv from 'dotenv';
import { z } from 'zod';

const integer = (fallback: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(max))
    .default(fallback);
const schema = z
  .object({
    RABBITMQ_ENABLED: z.enum(['true', 'false']).default('false'),
    RABBITMQ_URL: z.string().optional(),
    RABBITMQ_HOST: z.string().default('localhost').refine(isRabbitHost),
    RABBITMQ_PORT: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(65535))
      .optional(),
    RABBITMQ_USERNAME: z
      .string()
      .refine((v) => !!v.trim())
      .optional(),
    RABBITMQ_PASSWORD: z
      .string()
      .refine((v) => !!v.trim())
      .optional(),
    RABBITMQ_VHOST: z
      .string()
      .default('/')
      .refine((v) => !!v.trim()),
    RABBITMQ_TLS_ENABLED: z.enum(['true', 'false']).default('false'),
    RABBITMQ_PREFETCH: integer(10, 65535),
    RABBITMQ_PUBLISH_TIMEOUT_MS: integer(10000, 2147483647),
    RABBITMQ_MAX_IN_FLIGHT: integer(100, 10000),
    RABBITMQ_HEARTBEAT_SECONDS: integer(30, 65535),
    RABBITMQ_RECONNECT_SECONDS: integer(5, 86400),
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4102),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((v, ctx) => {
    if (v.RABBITMQ_ENABLED !== 'true') return;
    for (const key of ['RABBITMQ_USERNAME', 'RABBITMQ_PASSWORD'] as const)
      if (v[key] === undefined)
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'Required when enabled',
        });
    if (v.RABBITMQ_URL)
      ctx.addIssue({
        code: 'custom',
        path: ['RABBITMQ_URL'],
        message: 'Remove obsolete URL',
      });
  });

export interface AppConfig {
  rabbitmq: RabbitMqConfig;
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  logLevel: z.infer<typeof schema>['LOG_LEVEL'];
}

export function parseEnv(input: Record<string, string | undefined>): AppConfig {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => issue.path.join('.'))),
    ];
    if (fields.includes('RABBITMQ_URL'))
      throw new Error(
        'Invalid environment configuration: RABBITMQ_URL must be removed; use separate RabbitMQ connection variables.',
      );
    throw new Error(`Invalid environment configuration: ${fields.join(', ')}.`);
  }
  return {
    rabbitmq: {
      enabled: result.data.RABBITMQ_ENABLED === 'true',
      host: result.data.RABBITMQ_HOST,
      port:
        result.data.RABBITMQ_PORT ??
        (result.data.RABBITMQ_TLS_ENABLED === 'true' ? 5671 : 5672),
      username: result.data.RABBITMQ_USERNAME,
      password: result.data.RABBITMQ_PASSWORD,
      vhost: result.data.RABBITMQ_VHOST,
      tlsEnabled: result.data.RABBITMQ_TLS_ENABLED === 'true',
      prefetch: result.data.RABBITMQ_PREFETCH,
      publishTimeoutMs: result.data.RABBITMQ_PUBLISH_TIMEOUT_MS,
      maxInFlight: result.data.RABBITMQ_MAX_IN_FLIGHT,
      heartbeatSeconds: result.data.RABBITMQ_HEARTBEAT_SECONDS,
      reconnectSeconds: result.data.RABBITMQ_RECONNECT_SECONDS,
    },
    nodeEnv: result.data.NODE_ENV,
    port: result.data.PORT,
    logLevel: result.data.LOG_LEVEL,
  };
}

export function loadConfig(): AppConfig {
  dotenv.config({ quiet: true });
  return parseEnv(process.env);
}
