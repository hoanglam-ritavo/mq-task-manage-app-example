import { pino } from 'pino';
const logger = pino({ level: 'silent' });
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { ConfirmChannel } from 'amqplib';
import {
  connect,
  CreateChannelOpts,
  AmqpConnectionManager,
  ChannelWrapper,
} from 'amqp-connection-manager';
import { RabbitMqConnectionService } from '../src/helper/rabbitmq/rabbitmq-connection.service.js';

vi.mock('amqp-connection-manager', () => ({ connect: vi.fn() }));
const mockedConnect = vi.mocked(connect);
const rabbitmq = {
  enabled: true,
  host: 'broker',
  port: 5672,
  username: 'private',
  password: 'secret',
  vhost: 'vhost',
  tlsEnabled: false,
  prefetch: 10,
  publishTimeoutMs: 100,
  maxInFlight: 100,
  heartbeatSeconds: 30,
  reconnectSeconds: 5,
};

function fixture() {
  const creations: Array<{
    options: CreateChannelOpts;
    wrapper: ChannelWrapper;
  }> = [];
  const manager = new EventEmitter();
  const close = vi.fn(() => Promise.resolve());
  const createChannel = vi.fn((options: CreateChannelOpts) => {
    const wrapper = Object.assign(new EventEmitter(), {
      close: vi.fn(() => Promise.resolve()),
    }) as unknown as ChannelWrapper;
    creations.push({ options, wrapper });
    return wrapper;
  });
  Object.assign(manager, { close, createChannel, isConnected: () => true });
  mockedConnect.mockReturnValue(manager as AmqpConnectionManager);
  const service = new RabbitMqConnectionService(rabbitmq, logger);
  const setupAt = async (index: number) => {
    const raw = new EventEmitter() as unknown as ConfirmChannel;
    await (
      creations[index]!.options.setup as (c: ConfirmChannel) => Promise<void>
    )(raw);
    return raw;
  };
  return { service, manager, creations, setupAt, createChannel, close };
}

afterEach(() => {
  vi.restoreAllMocks();
  mockedConnect.mockReset();
  vi.useRealTimers();
});

describe('RabbitMQ connection lifecycle', () => {
  it('uses distinct managers for producer and consumer; channels recover independently', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const setup = vi.fn(() => Promise.resolve());
    const publisher = f.service.open('publisher', 'publish', setup);
    const consumer = f.service.open('consumer', 'consume', setup);
    expect(mockedConnect).toHaveBeenCalledTimes(2);
    const first = await f.setupAt(0);
    await f.setupAt(1);
    expect(publisher.ready).toBe(true);
    expect(consumer.ready).toBe(true);
    first.emit('close');
    await Promise.resolve();
    expect(publisher.ready).toBe(false);
    expect(consumer.ready).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    await f.setupAt(2);
    expect(publisher.ready).toBe(true);
    expect(setup).toHaveBeenCalledTimes(3);
    await f.service.close();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retries topology failures without deleting queues or reporting ready', async () => {
    vi.useFakeTimers();
    const errors = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    const f = fixture();
    const setup = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('secret topology'))
      .mockResolvedValue(undefined);
    const slot = f.service.open('consumer', 'queue', setup);
    await expect(f.setupAt(0)).rejects.toThrow('RabbitMQ channel setup failed');
    expect(slot.ready).toBe(false);
    await vi.advanceTimersByTimeAsync(5000);
    await f.setupAt(1);
    expect(slot.ready).toBe(true);
    expect(JSON.stringify(errors.mock.calls)).not.toContain('secret topology');
    await f.service.close();
  });
  it('cancels channel recovery when shutting down', async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.service.open('publisher', 'publish', () => Promise.resolve());
    (await f.setupAt(0)).emit('close');
    await Promise.resolve();
    await f.service.close();
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.createChannel).toHaveBeenCalledTimes(1);
  });
});

describe('RabbitMQ connection object', () => {
  it.each(['/', 'ordinary', 'division/team', '%2F', '\u0111\u1ed9i/%'])(
    'preserves vhost %s across the amqplib decode boundary',
    async (vhost) => {
      const f = fixture();
      Object.assign(f.service.settings, {
        vhost,
        username: ' user:@/% ',
        password: ' secret:@/% ',
        tlsEnabled: true,
        host: '::1',
        port: 5673,
      });
      f.service.open('publisher', 'test', async () => {});
      const urls = mockedConnect.mock.calls[0]![0] as Array<{
        protocol: string;
        hostname: string;
        port: number;
        username: string;
        password: string;
        vhost: string;
      }>;
      expect(urls[0]).toEqual({
        protocol: 'amqps',
        hostname: '::1',
        port: 5673,
        username: ' user:@/% ',
        password: ' secret:@/% ',
        vhost: encodeURIComponent(vhost),
      });
      expect(decodeURIComponent(urls[0]!.vhost)).toBe(vhost);
      await f.service.close();
    },
  );
});
