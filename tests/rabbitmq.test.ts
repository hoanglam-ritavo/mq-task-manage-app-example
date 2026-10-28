import { pino } from 'pino';
import type { RabbitMqConfig } from '../src/helper/rabbitmq/config.js';
const logger = pino({ level: 'silent' });
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ConfirmChannel, ConsumeMessage, Options } from 'amqplib';
import {
  RabbitMqConnectionService,
  ManagedRabbitChannel,
} from '../src/helper/rabbitmq/rabbitmq-connection.service.js';
import { RabbitMqPublisherService } from '../src/helper/rabbitmq/rabbitmq-publisher.service.js';
import { RabbitMqConsumerService } from '../src/helper/rabbitmq/rabbitmq-consumer.service.js';
import {
  RabbitMqTopologyService,
  subscriptionTopology,
} from '../src/helper/rabbitmq/rabbitmq-topology.service.js';
import {
  MessageEnvelope,
  NonRetryableMessageError,
  validateEnvelope,
} from '../src/helper/rabbitmq/rabbitmq.types.js';

const settings: RabbitMqConfig = {
  enabled: true,
  host: 'localhost',
  port: 5672,
  username: 'fixture',
  password: 'private',
  vhost: 'test',
  tlsEnabled: false,
  prefetch: 10,
  publishTimeoutMs: 100,
  maxInFlight: 2,
  heartbeatSeconds: 30,
  reconnectSeconds: 5,
};
const message: MessageEnvelope = {
  messageId: 'stable-id',
  type: 'employee.changed',
  schemaVersion: 1,
  source: 'fixture',
  occurredAt: '2026-10-28T00:00:00.000Z',
  data: { active: false },
};

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(enabled = true) {
  const channels: ReturnType<typeof channelFixture>[] = [];
  const slots: ManagedRabbitChannel[] = [];
  const setups: Promise<void>[] = [];
  const blocked = vi.fn(() => false);
  const connection = {
    settings: { ...settings, enabled },
    isBlocked: blocked,
    getStatus: () => (enabled ? 'ready' : 'disabled'),
    close: vi.fn(() => Promise.resolve()),
    open: vi.fn(
      (
        _kind: string,
        _name: string,
        setup: (c: ConfirmChannel) => Promise<void>,
      ) => {
        const channel = channelFixture();
        channels.push(channel);
        const slot: ManagedRabbitChannel = {
          raw: channel.raw,
          ready: false,
          closed: false,
          restart: vi.fn(() => {
            slot.raw = undefined;
            slot.ready = false;
            channel.emitter.emit('close');
            return Promise.resolve();
          }),
        };
        slots.push(slot);
        setups.push(
          setup(channel.raw).then(() => {
            slot.ready = true;
          }),
        );
        return slot;
      },
    ),
  };
  const service = connection as unknown as RabbitMqConnectionService;
  const publisher = new RabbitMqPublisherService(service, logger);
  const topology = new RabbitMqTopologyService();
  const consumer = new RabbitMqConsumerService(
    service,
    publisher,
    topology,
    logger,
  );
  publisher.start();
  const ready = () => Promise.all(setups);
  const lifecycle = {
    stop: async () => {
      publisher.stopAccepting();
      await consumer.stopAndDrain();
      await publisher.drain();
      await service.close();
    },
  };
  return { connection, publisher, consumer, channels, slots, ready, lifecycle };
}

function channelFixture() {
  const emitter = new EventEmitter();
  let receive: (message: ConsumeMessage | null) => void;
  const publish = vi.fn<
    (
      exchange: string,
      routing: string,
      body: Buffer,
      options: Options.Publish,
      callback: (error?: Error) => void,
    ) => boolean
  >(() => true);
  const api = {
    publish,
    assertExchange: vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    assertQueue: vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined),
    bindQueue: vi.fn(() => Promise.resolve()),
    prefetch: vi.fn(() => Promise.resolve()),
    consume: vi.fn(
      (_queue: string, handler: (message: ConsumeMessage | null) => void) => {
        receive = handler;
        return Promise.resolve({ consumerTag: 'tag' });
      },
    ),
    cancel: vi.fn(() => Promise.resolve()),
    ack: vi.fn(),
  };
  Object.assign(emitter, api);
  return {
    ...api,
    emitter,
    raw: emitter as unknown as ConfirmChannel,
    deliver: (body: Buffer, attempt?: number) => {
      const delivery = {
        content: body,
        fields: { deliveryTag: 1 },
        properties: {
          messageId: message.messageId,
          headers: attempt === undefined ? {} : { 'x-rita-retry': attempt },
        },
      } as ConsumeMessage;
      receive(delivery);
      return delivery;
    },
  };
}

let warnings: unknown[][] = [];
beforeEach(() => {
  warnings = [];
  vi.spyOn(logger, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args);
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('RabbitMQ envelope', () => {
  it('accepts the shared envelope without requiring job metadata', () =>
    expect(() => validateEnvelope(message)).not.toThrow());
  it.each([
    null,
    [],
    { ...message, messageId: ' ' },
    { ...message, schemaVersion: 0 },
    { ...message, occurredAt: '2026-02-30T00:00:00Z' },
    { ...message, occurredAt: 'yesterday' },
    { ...message, correlationId: '' },
  ])('rejects invalid metadata %p', (value) =>
    expect(() => validateEnvelope(value)).toThrow('INVALID_ENVELOPE'),
  );
});

describe('RabbitMQ publisher', () => {
  it('waits for confirm and preserves caller identity', async () => {
    const f = fixture();
    await f.ready();
    const task = f.publisher.publish({
      exchange: 'events',
      routingKey: 'employee.changed',
      message,
    });
    let complete = false;
    void task.then(() => {
      complete = true;
    });
    await Promise.resolve();
    expect(complete).toBe(false);
    const call = f.channels[0]!.publish.mock.calls[0]!;
    expect(JSON.parse(call[2]!.toString())).toEqual(message);
    expect(call[3]!).toMatchObject({
      persistent: true,
      mandatory: true,
      messageId: message.messageId,
      contentType: 'application/json',
    });
    call[4]!();
    await task;
    await f.lifecycle.stop();
  });
  it('correlates unroutable returns per attempt even when message IDs are reused', async () => {
    const f = fixture();
    await f.ready();
    const first = f.publisher.publish({
      exchange: 'events',
      routingKey: '',
      message,
    });
    const rejected = expect(first).rejects.toMatchObject({
      code: 'UNROUTABLE',
    });
    const second = f.publisher.publish({
      exchange: 'events',
      routingKey: '',
      message,
    });
    const calls = f.channels[0]!.publish.mock.calls;
    f.channels[0]!.emitter.emit('return', {
      properties: calls[0]![3]!,
    });
    calls[0]![4]!();
    calls[1]![4]!();
    await rejected;
    await second;
    await f.lifecycle.stop();
  });
  it('rejects broker nack without exposing driver error text', async () => {
    const f = fixture();
    await f.ready();
    const task = f.publisher.publish({
      exchange: 'events',
      routingKey: '',
      message,
    });
    const rejected = expect(task).rejects.toMatchObject({ code: 'NACKED' });
    f.channels[0]!.publish.mock.calls[0]![4]!(new Error('message nacked'));
    await rejected;
    await f.lifecycle.stop();
  });
  it('bounds in-flight work and rejects blocked/unavailable publishers', async () => {
    const f = fixture();
    await f.ready();
    const input = { exchange: 'events', routingKey: '', message };
    const first = f.publisher.publish(input);
    const second = f.publisher.publish(input);
    await expect(f.publisher.publish(input)).rejects.toMatchObject({
      code: 'IN_FLIGHT_LIMIT',
    });
    f.channels[0]!.publish.mock.calls.forEach((call) => call[4]!());
    await Promise.all([first, second]);
    f.connection.isBlocked.mockReturnValue(true);
    await expect(f.publisher.publish(input)).rejects.toMatchObject({
      code: 'BLOCKED',
    });
    f.connection.isBlocked.mockReturnValue(false);
    f.slots[0]!.ready = false;
    await expect(f.publisher.publish(input)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    await f.lifecycle.stop();
  });
  it('rejects further writes under backpressure until drain', async () => {
    const f = fixture();
    await f.ready();
    f.channels[0]!.publish.mockReturnValueOnce(false);
    const input = { exchange: 'events', routingKey: '', message };
    const task = f.publisher.publish(input);
    await expect(f.publisher.publish(input)).rejects.toMatchObject({
      code: 'BACKPRESSURE',
    });
    f.channels[0]!.publish.mock.calls[0]![4]!();
    await task;
    f.channels[0]!.emitter.emit('drain');
    const next = f.publisher.publish(input);
    f.channels[0]!.publish.mock.calls[1]![4]!();
    await next;
    await f.lifecycle.stop();
  });
  it('reports uncertainty on timeout and closes the channel without silently re-publishing', async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.ready();
    const task = f.publisher.publish({
      exchange: 'events',
      routingKey: '',
      message,
    });
    const rejected = expect(task).rejects.toMatchObject({
      code: 'DELIVERY_UNCERTAIN',
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(f.slots[0]!.restart).toHaveBeenCalledTimes(1);
    expect(f.channels[0]!.publish).toHaveBeenCalledTimes(1);
    await f.lifecycle.stop();
  });
  it('reports uncertainty if the channel closes before confirm', async () => {
    const f = fixture();
    await f.ready();
    const task = f.publisher.publish({
      exchange: 'events',
      routingKey: '',
      message,
    });
    const rejected = expect(task).rejects.toMatchObject({
      code: 'DELIVERY_UNCERTAIN',
    });
    f.channels[0]!.emitter.emit('close');
    await rejected;
    await f.lifecycle.stop();
  });
});

describe('RabbitMQ consumer', () => {
  const register = (
    f: ReturnType<typeof fixture>,
    handle: (m: MessageEnvelope) => Promise<void>,
    validate = (data: unknown) => data,
  ) => {
    f.consumer.register({
      queue: 'test.notifications',
      bindings: [{ exchange: 'events', type: 'topic', routingKey: '#' }],
      handle,
      validate,
    });
    f.consumer.start();
  };
  it('acks only after the accepted handler finishes and drains before connection teardown', async () => {
    const f = fixture();
    const work = gate();
    const entered = gate();
    register(f, async () => {
      entered.resolve();
      await work.promise;
    });
    await f.ready();
    const delivery = f.channels[1]!.deliver(
      Buffer.from(JSON.stringify(message)),
    );
    await entered.promise;
    expect(f.channels[1]!.ack).not.toHaveBeenCalled();
    const shutdown = f.lifecycle.stop();
    await Promise.resolve();
    expect(f.connection.close).not.toHaveBeenCalled();
    await expect(
      f.publisher.publish({ exchange: 'events', routingKey: '', message }),
    ).rejects.toMatchObject({ code: 'STOPPING' });
    expect(() =>
      f.consumer.register({
        queue: 'late',
        bindings: [],
        validate: (x) => x,
        handle: () => Promise.resolve(),
      }),
    ).toThrow('REGISTRATION_CLOSED');
    work.resolve();
    await shutdown;
    expect(f.channels[1]!.ack).toHaveBeenCalledWith(delivery);
    expect(f.connection.close).toHaveBeenCalledTimes(1);
  });
  it.each([0, 1, 2, 3])(
    'forwards failed attempt %i only to its private retry/DLQ and waits for confirm',
    async (attempt) => {
      const f = fixture();
      const entered = gate();
      register(f, () => {
        entered.resolve();
        return Promise.reject(new Error('private business details'));
      });
      await f.ready();
      const bytes = Buffer.from(JSON.stringify(message));
      f.channels[1]!.deliver(bytes, attempt);
      await entered.promise;
      await Promise.resolve();
      const call = f.channels[0]!.publish.mock.calls[0]!;
      expect(call[0]!).toBe('test.notifications.delivery');
      expect(call[1]!).toBe(
        attempt < 3
          ? `test.notifications.retry.${attempt + 1}`
          : 'test.notifications.dead',
      );
      expect(call[2]!).toEqual(bytes);
      expect(call[3]!.messageId).toBe(message.messageId);
      expect(f.channels[1]!.ack).not.toHaveBeenCalled();
      call[4]!();
      await f.lifecycle.stop();
      expect(f.channels[1]!.ack).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(warnings)).not.toContain(
        'private business details',
      );
    },
  );
  it.each(['json', 'payload', 'permanent'])(
    'sends %s failure directly to DLQ',
    async (failure) => {
      const f = fixture();
      register(
        f,
        () => Promise.reject(new NonRetryableMessageError()),
        (data) => {
          if (failure === 'payload') throw new Error('invalid');
          return data;
        },
      );
      await f.ready();
      f.channels[1]!.deliver(
        Buffer.from(failure === 'json' ? '{bad' : JSON.stringify(message)),
      );
      await Promise.resolve();
      await Promise.resolve();
      const call = f.channels[0]!.publish.mock.calls[0]!;
      expect(call[1]!).toBe('test.notifications.dead');
      call[4]!();
      await f.lifecycle.stop();
    },
  );
  it('does not ack on failed forwarding; cancels and schedules recovery', async () => {
    const f = fixture();
    register(f, () => Promise.reject(new Error('failed')));
    await f.ready();
    f.channels[1]!.deliver(Buffer.from(JSON.stringify(message)));
    await Promise.resolve();
    await Promise.resolve();
    f.channels[0]!.publish.mock.calls[0]![4]!(new Error('message nacked'));
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(f.channels[1]!.ack).not.toHaveBeenCalled();
    expect(f.channels[1]!.cancel).toHaveBeenCalled();
    expect(f.slots[1]!.restart).toHaveBeenCalledTimes(1);
    await f.lifecycle.stop();
  });
  it('does not ack old deliveries on a replacement channel', async () => {
    const f = fixture();
    const work = gate();
    register(f, () => work.promise);
    await f.ready();
    f.channels[1]!.deliver(Buffer.from(JSON.stringify(message)));
    f.slots[1]!.raw = channelFixture().raw;
    work.resolve();
    await f.lifecycle.stop();
    expect(f.channels[1]!.ack).not.toHaveBeenCalled();
  });
  it('declares quorum retry paths back to the subscriber rather than the broadcast exchange', async () => {
    const f = fixture();
    register(f, () => Promise.resolve());
    await f.ready();
    const topology = subscriptionTopology('test.notifications');
    expect(f.channels[1]!.assertQueue).toHaveBeenCalledWith(
      topology.retries[0]!.queue,
      expect.objectContaining({
        arguments: expect.objectContaining({
          'x-queue-type': 'quorum',
          'x-message-ttl': 10000,
          'x-dead-letter-exchange': topology.exchange,
          'x-dead-letter-routing-key': 'test.notifications',
          'x-dead-letter-strategy': 'at-least-once',
          'x-overflow': 'reject-publish',
        }),
      }),
    );
    await f.lifecycle.stop();
  });
});

describe('three-system routing contract with broker double', () => {
  it('fans out profile, routes commands separately, and delivers notifications to Rita', async () => {
    const f = fixture();
    const received: Record<string, string[]> = { sale: [], task: [], rita: [] };
    for (const name of ['sale', 'task', 'rita'])
      f.consumer.register({
        queue: name,
        bindings:
          name === 'rita'
            ? [
                {
                  exchange: 'commands',
                  type: 'direct',
                  routingKey: 'notification',
                },
              ]
            : [
                { exchange: 'events', type: 'fanout', routingKey: '' },
                { exchange: 'commands', type: 'direct', routingKey: name },
              ],
        validate: (data, envelope) => {
          if (envelope.schemaVersion !== 1)
            throw new Error('Unsupported version');
          return data;
        },
        handle: async (envelope) => {
          received[name]!.push(envelope.type);
        },
      });
    f.consumer.start();
    await f.ready();
    // Simulate routing from the bindings actually declared by the helper, not hand-written recipient lists.
    f.channels[0]!.publish.mockImplementation(
      (exchange, key, body, _options, confirm) => {
        for (const channel of f.channels.slice(1)) {
          if (
            channel.bindQueue.mock.calls.some((args) => {
              const binding = args as unknown as [string, string, string];
              return (
                binding[1] === exchange &&
                (exchange === 'events' || binding[2] === key)
              );
            })
          )
            channel.deliver(body);
        }
        confirm();
        return true;
      },
    );
    const send = (exchange: string, routingKey: string, type: string) =>
      f.publisher.publish({
        exchange,
        routingKey,
        message: { ...message, type },
      });
    await send('events', '', 'employee.profile.changed');
    await send('commands', 'sale', 'sale.create');
    await send('commands', 'task', 'task.create');
    await send('commands', 'notification', 'notification.created');
    await f.lifecycle.stop();
    expect(received).toEqual({
      sale: ['employee.profile.changed', 'sale.create'],
      task: ['employee.profile.changed', 'task.create'],
      rita: ['notification.created'],
    });
  });
});
