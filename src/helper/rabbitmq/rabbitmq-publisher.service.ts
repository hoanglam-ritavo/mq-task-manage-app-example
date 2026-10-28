import type { Logger } from 'pino';
import { ConfirmChannel, Message, Options } from 'amqplib';
import { randomUUID } from 'node:crypto';
import {
  ManagedRabbitChannel,
  RabbitMqConnectionService,
} from './rabbitmq-connection.service.js';
import {
  MessageEnvelope,
  messageHeaders,
  messageString,
  RabbitMqError,
  validateEnvelope,
  validateName,
} from './rabbitmq.types.js';

interface Pending {
  channel: ConfirmChannel;
  finish: (error?: RabbitMqError) => void;
}

export class RabbitMqPublisherService {
  private slot?: ManagedRabbitChannel;
  private readonly pending = new Map<string, Pending>();
  private readonly tasks = new Set<Promise<void>>();
  private stopping = false;
  private writable = true;

  constructor(
    private readonly connection: RabbitMqConnectionService,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (!this.connection.settings.enabled) return;
    this.slot = this.connection.open(
      'publisher',
      'rita-publisher',
      async (channel) => {
        this.writable = true;
        channel.on('drain', () => {
          if (this.slot?.raw === channel) this.writable = true;
        });
        channel.on('return', (message: Message) => {
          const id: unknown = message.properties.headers?.['x-rita-publish-id'];
          if (typeof id === 'string')
            this.pending.get(id)?.finish(new RabbitMqError('UNROUTABLE'));
        });
        channel.once('close', () =>
          this.failPending(channel, 'DELIVERY_UNCERTAIN'),
        );
        await Promise.resolve();
      },
    );
  }

  async publish(input: {
    exchange: string;
    routingKey: string;
    message: MessageEnvelope;
  }): Promise<void> {
    if (this.stopping) throw new RabbitMqError('STOPPING');
    validateName(input.exchange);
    validateEnvelope(input.message);
    if (
      typeof input.routingKey !== 'string' ||
      Buffer.byteLength(input.routingKey) > 255
    )
      throw new RabbitMqError('INVALID_ROUTING_KEY');
    let content: Buffer;
    try {
      content = Buffer.from(JSON.stringify(input.message));
    } catch {
      throw new RabbitMqError('INVALID_JSON');
    }
    return this.sendRaw(input.exchange, input.routingKey, content, {
      messageId: input.message.messageId,
      type: input.message.type,
      correlationId: input.message.correlationId,
      contentType: 'application/json',
    });
  }

  /** Transport-only forwarding for accepted deliveries, including during drain. */
  sendRaw(
    exchange: string,
    routingKey: string,
    content: Buffer,
    options: Options.Publish,
  ): Promise<void> {
    const settings = this.connection.settings;
    if (!settings.enabled) return Promise.reject(new RabbitMqError('DISABLED'));
    const channel = this.slot?.raw;
    if (!this.slot?.ready || !channel)
      return Promise.reject(new RabbitMqError('UNAVAILABLE'));
    if (this.connection.isBlocked())
      return Promise.reject(new RabbitMqError('BLOCKED'));
    if (!this.writable)
      return Promise.reject(new RabbitMqError('BACKPRESSURE'));
    if (this.pending.size >= settings.maxInFlight)
      return Promise.reject(new RabbitMqError('IN_FLIGHT_LIMIT'));
    const id = randomUUID();
    const started = Date.now();
    const task = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.get(id)?.finish(new RabbitMqError('DELIVERY_UNCERTAIN'));
        // Discard this channel: late confirms must not resolve a later attempt.
        if (this.slot?.raw === channel) void this.slot.restart();
      }, settings.publishTimeoutMs);
      this.pending.set(id, {
        channel,
        finish: (error) => {
          if (!this.pending.delete(id)) return;
          clearTimeout(timer);
          if (error) {
            this.logger.warn({
              event: 'rabbitmq_publish_failed',
              code: error.code,
              messageId: messageString(options.messageId),
              durationMs: Date.now() - started,
            });
            reject(error);
          } else {
            this.logger.debug({
              event: 'rabbitmq_published',
              messageId: messageString(options.messageId),
              durationMs: Date.now() - started,
            });
            resolve();
          }
        },
      });
      try {
        this.writable = channel.publish(
          exchange,
          routingKey,
          content,
          {
            ...options,
            persistent: true,
            mandatory: true,
            headers: {
              ...messageHeaders(options.headers),
              'x-rita-publish-id': id,
            },
          },
          (error: unknown) => {
            const code =
              error instanceof Error && error.message === 'message nacked'
                ? 'NACKED'
                : 'DELIVERY_UNCERTAIN';
            this.pending
              .get(id)
              ?.finish(error ? new RabbitMqError(code) : undefined);
          },
        );
      } catch {
        this.pending.get(id)?.finish(new RabbitMqError('DELIVERY_UNCERTAIN'));
      }
    });
    this.tasks.add(task);
    void task.then(
      () => this.tasks.delete(task),
      () => this.tasks.delete(task),
    );
    return task;
  }

  private failPending(channel: ConfirmChannel, code: string): void {
    for (const item of [...this.pending.values()])
      if (item.channel === channel) item.finish(new RabbitMqError(code));
  }

  stopAccepting(): void {
    this.stopping = true;
  }
  async drain(): Promise<void> {
    await Promise.allSettled([...this.tasks]);
  }
}
