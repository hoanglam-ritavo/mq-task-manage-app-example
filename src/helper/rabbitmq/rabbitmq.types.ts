export interface MessageEnvelope<T = unknown> {
  messageId: string;
  type: string;
  schemaVersion: number;
  source: string;
  occurredAt: string;
  correlationId?: string;
  data: T;
}

export interface ExchangeBinding {
  exchange: string;
  type: 'direct' | 'topic' | 'fanout';
  routingKey: string;
}

export interface RabbitMqSubscription<T> {
  queue: string;
  bindings: readonly ExchangeBinding[];
  /** Must throw for invalid data. Return a validated value, not a type assertion. */
  validate: (data: unknown, envelope: MessageEnvelope) => T;
  handle: (message: MessageEnvelope<T>) => Promise<void>;
}

export type RabbitMqState =
  'disabled' | 'connecting' | 'ready' | 'degraded' | 'stopping';

export class RabbitMqError extends Error {
  constructor(public readonly code: string) {
    super(`RabbitMQ operation failed: ${code}`);
    this.name = 'RabbitMqError';
  }
}

export class NonRetryableMessageError extends Error {}

export function messageHeaders(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function messageString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

const nonblank = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export function validateEnvelope(
  value: unknown,
): asserts value is MessageEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RabbitMqError('INVALID_ENVELOPE');
  const m = value as Record<string, unknown>;
  if (
    !nonblank(m.messageId) ||
    !nonblank(m.type) ||
    !nonblank(m.source) ||
    !Number.isSafeInteger(m.schemaVersion) ||
    Number(m.schemaVersion) < 1 ||
    typeof m.occurredAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
      m.occurredAt,
    ) ||
    !Number.isFinite(Date.parse(m.occurredAt)) ||
    new Date(m.occurredAt).toISOString().replace(/\.000Z$/, 'Z') !==
      m.occurredAt
        .replace(
          /\.(\d{1,2})Z$/,
          (_, digits: string) => `.${digits.padEnd(3, '0')}Z`,
        )
        .replace(/\.000Z$/, 'Z') ||
    (m.correlationId !== undefined && !nonblank(m.correlationId)) ||
    !Object.hasOwn(m, 'data') ||
    m.data === undefined
  ) {
    throw new RabbitMqError('INVALID_ENVELOPE');
  }
}

export function validateName(name: string): void {
  if (
    typeof name !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,179}$/.test(name) ||
    name.startsWith('amq.')
  ) {
    throw new RabbitMqError('INVALID_TOPOLOGY_NAME');
  }
}
