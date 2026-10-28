import { pino } from 'pino';
const logger = pino({ level: 'silent' });
import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import * as amqp from 'amqplib';
import * as managedAmqp from 'amqp-connection-manager';
import { RabbitMqConnectionService } from '../src/helper/rabbitmq/rabbitmq-connection.service.js';
import { RabbitMqPublisherService } from '../src/helper/rabbitmq/rabbitmq-publisher.service.js';
import { RabbitMqConsumerService } from '../src/helper/rabbitmq/rabbitmq-consumer.service.js';
import {
  RabbitMqTopologyService,
  subscriptionTopology,
} from '../src/helper/rabbitmq/rabbitmq-topology.service.js';

// No dotenv or application config: this must be an explicitly disposable vhost.
// Test-only adapter: URL is never accepted by runtime configuration.
function testConnection(input: string) {
  const u = new URL(input);
  if (!['amqp:', 'amqps:'].includes(u.protocol) || u.search || u.hash)
    throw new Error('Invalid disposable broker URL');
  return {
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port: u.port ? Number(u.port) : u.protocol === 'amqps:' ? 5671 : 5672,
    username:
      u.username || u.password ? decodeURIComponent(u.username) : 'guest',
    password:
      u.username || u.password ? decodeURIComponent(u.password) : 'guest',
    vhost:
      u.pathname.length > 1 ? decodeURIComponent(u.pathname.slice(1)) : '/',
    tlsEnabled: u.protocol === 'amqps:',
  };
}
const url = process.env.RABBITMQ_TEST_URL;
const suite = url ? describe : describe.skip;

async function until(
  check: () => boolean | Promise<boolean>,
  timeout = 15000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() >= deadline)
      throw new Error('Timed out waiting for disposable broker');
    await new Promise((done) => setTimeout(done, 25));
  }
}

async function receive(
  channel: amqp.Channel,
  queue: string,
): Promise<amqp.GetMessage> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const message = await channel.get(queue, { noAck: false });
    if (message) return message;
    await new Promise((done) => setTimeout(done, 25));
  }
  throw new Error('Timed out waiting for a message');
}

async function withBroker(
  work: (f: Awaited<ReturnType<typeof harness>>) => Promise<void>,
) {
  const f = await harness();
  try {
    await work(f);
  } finally {
    await f.cleanup();
  }
}

async function harness() {
  const prefix = `rita_test_${randomUUID().replace(/-/g, '')}`;
  const names = {
    event: `${prefix}.events`,
    command: `${prefix}.commands`,
    a: `${prefix}.a`,
    b: `${prefix}.b`,
    raw: `${prefix}.raw`,
  };
  const spy = vi.spyOn(managedAmqp, 'connect');
  const connection = new RabbitMqConnectionService(
    {
      enabled: true,
      ...testConnection(url!),
      prefetch: 2,
      publishTimeoutMs: 3000,
      maxInFlight: 100,
      heartbeatSeconds: 2,
      reconnectSeconds: 1,
    },
    logger,
  );
  const publisher = new RabbitMqPublisherService(connection, logger);
  const consumer = new RabbitMqConsumerService(
    connection,
    publisher,
    new RabbitMqTopologyService(),
    logger,
  );
  const lifecycle = {
    stop: async () => {
      publisher.stopAccepting();
      await consumer.stopAndDrain();
      await publisher.drain();
      await connection.close();
    },
  };
  const deliveries: string[][] = [[], []];
  let failA = false;
  for (const [index, queue] of [names.a, names.b].entries()) {
    consumer.register({
      queue,
      bindings: [
        { exchange: names.event, type: 'fanout', routingKey: '' },
        { exchange: names.command, type: 'direct', routingKey: String(index) },
      ],
      validate: (data) => data,
      handle: (message) => {
        deliveries[index]!.push(message.messageId);
        if (index === 0 && failA) {
          failA = false;
          return Promise.reject(new Error('retry once'));
        }
        return Promise.resolve();
      },
    });
  }
  let admin: amqp.ChannelModel | undefined;
  let channel: amqp.Channel | undefined;
  const cleanup = async () => {
    await lifecycle.stop();
    try {
      if (admin) {
        const removals: Array<() => Promise<void>> = [];
        const remove = async (kind: 'queue' | 'exchange', name: string) => {
          // A missing resource closes its channel; isolate each cleanup operation.
          const cleanupChannel = await admin!.createChannel();
          cleanupChannel.on('error', () => undefined);
          try {
            if (kind === 'queue') await cleanupChannel.deleteQueue(name);
            else await cleanupChannel.deleteExchange(name);
          } catch (error) {
            if (
              !error ||
              typeof error !== 'object' ||
              !('code' in error) ||
              error.code !== 404
            )
              throw new Error('Disposable broker cleanup failed', {
                cause: error,
              });
          } finally {
            await cleanupChannel.close().catch(() => undefined);
          }
        };
        for (const queue of [names.a, names.b]) {
          const topology = subscriptionTopology(queue);
          for (const name of [
            queue,
            topology.dead,
            ...topology.retries.map((r) => r.queue),
          ])
            removals.push(() => remove('queue', name));
          removals.push(() => remove('exchange', topology.exchange));
        }
        removals.push(() => remove('queue', names.raw));
        removals.push(() => remove('exchange', names.event));
        removals.push(() => remove('exchange', names.command));
        const results = await Promise.allSettled(
          removals.map((remove) => remove()),
        );
        if (results.some((result) => result.status === 'rejected'))
          throw new Error('Disposable broker cleanup incomplete');
      }
    } finally {
      await admin?.close().catch(() => undefined);
      spy.mockRestore();
    }
  };
  try {
    admin = await amqp.connect(url!, { timeout: 3000 });
    admin.on('error', () => undefined);
    channel = await admin.createChannel();
    channel.on('error', () => undefined);
    publisher.start();
    consumer.start();
    await until(() => consumer.getStatus().state === 'ready');
  } catch (error) {
    await cleanup();
    throw error;
  }
  const send = (id: string, exchange = names.event, routingKey = '') =>
    publisher.publish({
      exchange,
      routingKey,
      message: {
        messageId: id,
        type: 'fixture.changed',
        source: 'test',
        schemaVersion: 1,
        occurredAt: new Date().toISOString(),
        data: { fixture: true },
      },
    });
  return {
    names,
    deliveries,
    consumer,
    publisher,
    channel,
    send,
    cleanup,
    failNextA: () => {
      failA = true;
    },
    disconnect: async () => {
      const managers = spy.mock.results.flatMap((result) =>
        result.type === 'return' ? [result.value] : [],
      );
      await Promise.all(managers.map((manager) => manager.connection?.close()));
      await until(() => consumer.getStatus().state === 'ready');
    },
  };
}

suite('RabbitMQ disposable broker', () => {
  it('publishes a notification to a single Rita ID fixture queue', async () => {
    await withBroker(async (f) => {
      await f.channel.assertQueue(f.names.raw, {
        durable: true,
        arguments: { 'x-queue-type': 'quorum' },
      });
      await f.channel.bindQueue(
        f.names.raw,
        f.names.command,
        'rita.notification',
      );
      await f.publisher.publish({
        exchange: f.names.command,
        routingKey: 'rita.notification',
        message: {
          messageId: 'notification-id',
          type: 'notification.created',
          schemaVersion: 1,
          source: 'task-manage-app-example',
          occurredAt: new Date().toISOString(),
          data: { note: 'fictional' },
        },
      });
      const received = await receive(f.channel, f.names.raw);
      expect(JSON.parse(received.content.toString())).toMatchObject({
        messageId: 'notification-id',
        type: 'notification.created',
        source: 'task-manage-app-example',
      });
      f.channel.ack(received);
      expect(f.deliveries).toEqual([[], []]);
    });
  }, 30000);

  it('fans out events, directs commands and rejects unroutable messages', async () => {
    await withBroker(async (f) => {
      await f.send('event');
      await until(() => f.deliveries.every((d) => d.includes('event')));
      await f.send('command', f.names.command, '0');
      await until(() => f.deliveries[0]!.includes('command'));
      expect(f.deliveries[1]!).toEqual(['event']);
      await expect(
        f.send('unroutable', f.names.command, 'absent'),
      ).rejects.toMatchObject({ code: 'UNROUTABLE' });
    });
  }, 30000);
  it('retries only the failed subscriber and stores invalid bytes in its DLQ', async () => {
    await withBroker(async (f) => {
      f.failNextA();
      await f.send('retry');
      await until(
        () => f.deliveries[0]!.length === 2 && f.deliveries[1]!.length === 1,
        20000,
      );
      expect(f.deliveries).toEqual([['retry', 'retry'], ['retry']]);
      const topology = subscriptionTopology(f.names.a);
      await f.publisher.sendRaw(
        topology.exchange,
        f.names.a,
        Buffer.from('{invalid'),
        { messageId: 'invalid-id' },
      );
      const dead = await receive(f.channel, topology.dead);
      expect(dead.content.toString()).toBe('{invalid');
      expect(dead.properties.messageId).toBe('invalid-id');
      f.channel.ack(dead);
    });
  }, 40000);
  it('rebuilds consumers after connection loss without duplicate subscriptions', async () => {
    await withBroker(async (f) => {
      await f.disconnect();
      await f.send('reconnected');
      await until(() => f.deliveries.every((d) => d.includes('reconnected')));
      expect((await f.channel.checkQueue(f.names.a)).consumerCount).toBe(1);
      expect((await f.channel.checkQueue(f.names.b)).consumerCount).toBe(1);
    });
  }, 30000);
  it('redelivers an unacknowledged message after its channel closes', async () => {
    await withBroker(async (f) => {
      await f.channel.assertQueue(f.names.raw, {
        durable: true,
        arguments: { 'x-queue-type': 'quorum' },
      });
      await f.publisher.sendRaw('', f.names.raw, Buffer.from('fixture'), {
        messageId: 'redelivery',
      });
      const first = await f.channel.get(f.names.raw, { noAck: false });
      expect(first).not.toBe(false);
      await f.channel.close();
      // A separate connection checks redelivery; no application database is involved.
      const reader = await amqp.connect(url!, { timeout: 3000 });
      try {
        const channel = await reader.createChannel();
        const next = await receive(channel, f.names.raw);
        expect(next.fields.redelivered).toBe(true);
        channel.ack(next);
      } finally {
        await reader.close();
      }
    });
  }, 30000);
});
