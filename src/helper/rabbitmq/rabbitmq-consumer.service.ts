import type { Logger } from 'pino';
import { ConfirmChannel, ConsumeMessage } from 'amqplib';
import {
  ManagedRabbitChannel,
  RabbitMqConnectionService,
} from './rabbitmq-connection.service.js';
import { RabbitMqPublisherService } from './rabbitmq-publisher.service.js';
import {
  RabbitMqTopologyService,
  subscriptionTopology,
} from './rabbitmq-topology.service.js';
import {
  MessageEnvelope,
  messageHeaders,
  messageString,
  NonRetryableMessageError,
  RabbitMqError,
  RabbitMqSubscription,
  validateEnvelope,
  validateName,
} from './rabbitmq.types.js';

interface SubscriptionState {
  definition: RabbitMqSubscription<unknown>;
  slot?: ManagedRabbitChannel;
  tag?: string;
  paused: boolean;
  tasks: Set<Promise<void>>;
  recovery?: Promise<void>;
}

export class RabbitMqConsumerService {
  private readonly subscriptions = new Map<string, SubscriptionState>();
  private readonly exchanges = new Map<string, string>();
  private started = false;
  private stopping = false;

  constructor(
    private readonly connection: RabbitMqConnectionService,
    private readonly publisher: RabbitMqPublisherService,
    private readonly topology: RabbitMqTopologyService,
    private readonly logger: Logger,
  ) {}

  register<T>(definition: RabbitMqSubscription<T>): void {
    if (this.started || this.stopping)
      throw new RabbitMqError('REGISTRATION_CLOSED');
    validateName(definition.queue);
    if (this.subscriptions.has(definition.queue))
      throw new RabbitMqError('DUPLICATE_SUBSCRIPTION');
    if (
      !definition.bindings.length ||
      typeof definition.validate !== 'function' ||
      typeof definition.handle !== 'function'
    )
      throw new RabbitMqError('INVALID_SUBSCRIPTION');
    for (const binding of definition.bindings) {
      validateName(binding.exchange);
      if (
        !['direct', 'topic', 'fanout'].includes(binding.type) ||
        typeof binding.routingKey !== 'string' ||
        Buffer.byteLength(binding.routingKey) > 255
      )
        throw new RabbitMqError('INVALID_BINDING');
      const previous = this.exchanges.get(binding.exchange);
      if (previous && previous !== binding.type)
        throw new RabbitMqError('EXCHANGE_TYPE_CONFLICT');
    }
    for (const binding of definition.bindings)
      this.exchanges.set(binding.exchange, binding.type);
    const wrapped: RabbitMqSubscription<unknown> = {
      queue: definition.queue,
      bindings: definition.bindings.map((b) => ({ ...b })),
      validate: definition.validate,
      handle: (message) => definition.handle(message as MessageEnvelope<T>),
    };
    this.subscriptions.set(definition.queue, {
      definition: wrapped,
      paused: false,
      tasks: new Set(),
    });
  }

  start(): void {
    this.started = true;
    if (!this.connection.settings.enabled) return;
    for (const state of this.subscriptions.values()) {
      state.slot = this.connection.open(
        'consumer',
        state.definition.queue,
        async (channel) => {
          await this.topology.setup(channel, state.definition);
          await channel.prefetch(this.connection.settings.prefetch);
          if (this.stopping) return;
          state.paused = false;
          const result = await channel.consume(
            state.definition.queue,
            (message) => {
              if (state.slot?.raw !== channel) return;
              if (!message) {
                if (!this.stopping) void this.pause(state, channel);
                return;
              }
              if (this.stopping || state.paused) return; // Closing the channel requeues these deliveries.
              const task = this.process(state, channel, message);
              state.tasks.add(task);
              void task.then(
                () => state.tasks.delete(task),
                () => state.tasks.delete(task),
              );
            },
            { noAck: false },
          );
          state.tag = result.consumerTag;
          if (this.stopping) await channel.cancel(result.consumerTag);
        },
      );
    }
  }

  getStatus() {
    return {
      state: this.stopping
        ? ('stopping' as const)
        : this.connection.getStatus(),
      subscriptions: Object.fromEntries(
        [...this.subscriptions].map(([queue, s]) => [
          queue,
          !this.connection.settings.enabled
            ? 'disabled'
            : this.stopping
              ? 'stopping'
              : s.slot?.ready && !s.paused
                ? 'ready'
                : 'degraded',
        ]),
      ),
    };
  }

  private async process(
    state: SubscriptionState,
    channel: ConfirmChannel,
    delivery: ConsumeMessage,
  ): Promise<void> {
    let valid = false;
    try {
      const envelope: unknown = JSON.parse(delivery.content.toString('utf8'));
      validateEnvelope(envelope);
      const data = state.definition.validate(envelope.data, envelope);
      valid = true;
      await state.definition.handle({ ...envelope, data });
      if (state.slot?.raw === channel) channel.ack(delivery);
    } catch (error) {
      if (state.slot?.raw !== channel) return;
      const rawAttempt: unknown = delivery.properties.headers?.['x-rita-retry'];
      const attempt =
        rawAttempt === undefined
          ? 0
          : typeof rawAttempt === 'number' &&
              Number.isSafeInteger(rawAttempt) &&
              rawAttempt >= 0
            ? rawAttempt
            : 3;
      const topology = subscriptionTopology(state.definition.queue);
      const retry =
        valid &&
        !(error instanceof NonRetryableMessageError) &&
        attempt < topology.retries.length;
      const target = retry ? topology.retries[attempt]!.queue : topology.dead;
      try {
        // Do not copy expiration or userId: TTL could delete dead letters, and userId is connection-authenticated.
        await this.publisher.sendRaw(
          topology.exchange,
          target,
          delivery.content,
          {
            messageId: messageString(delivery.properties.messageId),
            type: messageString(delivery.properties.type),
            correlationId: messageString(delivery.properties.correlationId),
            contentType: messageString(delivery.properties.contentType),
            headers: {
              ...messageHeaders(delivery.properties.headers),
              'x-rita-retry': retry ? attempt + 1 : attempt,
              'x-rita-error': !valid
                ? 'INVALID_MESSAGE'
                : retry
                  ? 'HANDLER_FAILED'
                  : 'NON_RETRYABLE_OR_EXHAUSTED',
            },
          },
        );
        if (state.slot?.raw === channel) channel.ack(delivery);
      } catch {
        this.logger.warn({
          event: 'rabbitmq_forward_failed',
          queue: state.definition.queue,
        });
        // Do not wait on recovery here: it waits for this accepted task as well.
        void this.pause(state, channel);
      }
    }
  }

  private pause(
    state: SubscriptionState,
    channel: ConfirmChannel,
  ): Promise<void> {
    if (state.recovery !== undefined) return state.recovery;
    state.paused = true;
    state.recovery = (async () => {
      if (state.tag) await channel.cancel(state.tag).catch(() => undefined);
      await Promise.allSettled([...state.tasks]);
      if (!this.stopping && state.slot?.raw === channel)
        await state.slot.restart();
    })().finally(() => {
      state.recovery = undefined;
    });
    return state.recovery;
  }

  async stopAndDrain(): Promise<void> {
    this.stopping = true;
    await Promise.allSettled(
      [...this.subscriptions.values()].map(async (s) => {
        if (s.slot?.raw && s.tag)
          await s.slot.raw.cancel(s.tag).catch(() => undefined);
        await Promise.allSettled([...s.tasks]);
        await s.recovery;
      }),
    );
  }
}
