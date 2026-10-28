import { afterEach, describe, it, expect, vi } from 'vitest';
import { pino } from 'pino';
import request from 'supertest';
import type { Server } from 'node:http';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createRabbitMq } from '../src/helper/rabbitmq/index.js';
import { createShutdown } from '../src/shutdown.js';
const logger = pino({ level: 'silent' });
afterEach(() => vi.useRealTimers());
describe('Express messaging lifecycle', () => {
  it('disabled facade starts idempotently and closes registration', async () => {
    const helper = createRabbitMq(parseEnv({}).rabbitmq, logger);
    helper.start();
    helper.start();
    expect(helper.getStatus().state).toBe('disabled');
    const stop = helper.stop();
    expect(helper.stop()).toBe(stop);
    await stop;
    expect(() => helper.start()).toThrow();
    expect(() =>
      helper.register({
        queue: 'test',
        bindings: [],
        validate: (x) => x,
        handle: async () => {},
      }),
    ).toThrow();
  });
  it('offline broker does not block health', async () => {
    const config = parseEnv({
      RABBITMQ_ENABLED: 'true',
      RABBITMQ_HOST: '127.0.0.1',
      RABBITMQ_PORT: '1',
      RABBITMQ_USERNAME: 'fixture',
      RABBITMQ_PASSWORD: 'fixture',
      RABBITMQ_VHOST: 'test',
    });
    const helper = createRabbitMq(config.rabbitmq, logger);
    try {
      helper.start();
      await request(createApp(config, logger)).get('/health').expect(200);
      expect(helper.getStatus().state).not.toBe('ready');
    } finally {
      await helper.stop();
    }
  });
  it('waits for messaging beyond HTTP deadline without forced process exit', async () => {
    vi.useFakeTimers();
    let complete!: () => void;
    let close!: () => void;
    const messaging = {
      stop: vi.fn(
        () =>
          new Promise<void>((r) => {
            complete = r;
          }),
      ),
    };
    const http = {
      close: vi.fn((cb: () => void) => {
        close = cb;
      }),
      closeAllConnections: vi.fn(() => close()),
    };
    const exit = vi.fn();
    const shutdown = createShutdown(
      http as unknown as Server,
      messaging,
      logger,
      exit,
    );
    const pending = shutdown('SIGTERM');
    expect(shutdown('SIGINT')).toBe(pending);
    let finished = false;
    void pending.then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(10001);
    expect(http.closeAllConnections).toHaveBeenCalledOnce();
    expect(finished).toBe(false);
    complete();
    await pending;
    expect(exit).toHaveBeenLastCalledWith(1);
    expect(messaging.stop).toHaveBeenCalledOnce();
  });
});
