import { describe, it, expect } from 'vitest';
import { parseEnv } from '../src/config/env.js';
describe('RabbitMQ config', () => {
  it('defaults disabled and preserves false', () => {
    expect(parseEnv({}).rabbitmq).toMatchObject({
      enabled: false,
      prefetch: 10,
      publishTimeoutMs: 10000,
      maxInFlight: 100,
      heartbeatSeconds: 30,
      reconnectSeconds: 5,
    });
    expect(parseEnv({ RABBITMQ_ENABLED: 'false' }).rabbitmq.enabled).toBe(
      false,
    );
  });
  it.each([
    { RABBITMQ_ENABLED: 'yes' },
    { RABBITMQ_ENABLED: 'true' },
    { RABBITMQ_ENABLED: 'true', RABBITMQ_URL: 'https://secret' },
    { RABBITMQ_ENABLED: 'true', RABBITMQ_URL: 'amqp://host/v?secret=1' },
    { RABBITMQ_PREFETCH: '0' },
    { RABBITMQ_MAX_IN_FLIGHT: '1.5' },
    { RABBITMQ_RECONNECT_SECONDS: '' },
  ])('rejects invalid config without values %j', (input) => {
    expect(() => parseEnv(input)).toThrow('Invalid environment configuration');
    expect(() => parseEnv(input)).not.toThrow('secret');
  });
  it('accepts TLS vhost', () =>
    expect(
      parseEnv({
        RABBITMQ_ENABLED: 'true',
        RABBITMQ_HOST: 'broker.example.test',
        RABBITMQ_USERNAME: 'user',
        RABBITMQ_PASSWORD: 'secret',
        RABBITMQ_TLS_ENABLED: 'true',
      }).rabbitmq.enabled,
    ).toBe(true));
});

describe('split RabbitMQ connection settings', () => {
  const parse = (extra: Record<string, string | undefined> = {}) =>
    parseEnv(extra).rabbitmq;
  const credentials = {
    RABBITMQ_ENABLED: 'true',
    RABBITMQ_USERNAME: 'user',
    RABBITMQ_PASSWORD: 'password',
  };
  it('defaults ports by TLS and respects explicit port', () => {
    expect(parse().port).toBe(5672);
    expect(parse({ RABBITMQ_TLS_ENABLED: 'true' }).port).toBe(5671);
    expect(
      parse({ RABBITMQ_TLS_ENABLED: 'true', RABBITMQ_PORT: '5673' }).port,
    ).toBe(5673);
  });
  it.each([
    'localhost',
    'broker.example.test',
    '127.0.0.1',
    '::1',
    '2001:db8::1',
  ])('accepts host %s', (host) =>
    expect(parse({ RABBITMQ_HOST: host }).host).toBe(host),
  );
  it.each([
    'amqp://host',
    'host:5672',
    'host/path',
    ' host',
    'host ',
    '[::1]',
    '',
    'bad_host',
  ])('rejects invalid host %s', (host) =>
    expect(() => parse({ RABBITMQ_HOST: host })).toThrow('RABBITMQ_HOST'),
  );
  it.each([
    { RABBITMQ_PORT: '0' },
    { RABBITMQ_PORT: '65536' },
    { RABBITMQ_PORT: '1.5' },
    { RABBITMQ_TLS_ENABLED: 'yes' },
    { RABBITMQ_USERNAME: '' },
    { RABBITMQ_PASSWORD: ' ' },
    { RABBITMQ_VHOST: '' },
  ])('rejects supplied invalid fields even disabled %j', (extra) =>
    expect(() => parse(extra)).toThrow(),
  );
  it('requires both credentials only when enabled', () => {
    expect(() => parse()).not.toThrow();
    expect(() =>
      parse({ RABBITMQ_ENABLED: 'true', RABBITMQ_USERNAME: 'u' }),
    ).toThrow('RABBITMQ_PASSWORD');
    expect(() =>
      parse({ RABBITMQ_ENABLED: 'true', RABBITMQ_PASSWORD: 'p' }),
    ).toThrow('RABBITMQ_USERNAME');
  });
  it('preserves secret bytes and raw vhost', () => {
    const special = '  @:/% m\u1eadt kh\u1ea9u  ';
    expect(
      parse({
        ...credentials,
        RABBITMQ_USERNAME: special,
        RABBITMQ_PASSWORD: special,
        RABBITMQ_VHOST: '/%2F/\u0111\u1ed9i',
      }),
    ).toMatchObject({
      username: special,
      password: special,
      vhost: '/%2F/\u0111\u1ed9i',
    });
  });
  it('rejects obsolete URL only when enabled, without leaking it', () => {
    const old = 'amqp://private:topsecret@broker/v';
    expect(() => parse({ RABBITMQ_URL: old })).not.toThrow();
    expect(() => parse({ ...credentials, RABBITMQ_URL: old })).toThrow(
      'RABBITMQ_URL',
    );
    expect(() => parse({ ...credentials, RABBITMQ_URL: old })).not.toThrow(
      'topsecret',
    );
    expect(() => parse({ ...credentials, RABBITMQ_URL: '' })).not.toThrow();
  });
});
