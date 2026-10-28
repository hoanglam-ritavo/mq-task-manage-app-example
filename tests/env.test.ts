import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';

describe('environment configuration', () => {
  it('provides application defaults', () => {
    expect(parseEnv({})).toMatchObject({
      nodeEnv: 'development',
      port: 4102,
      logLevel: 'info',
    });
  });
  it('accepts explicit valid configuration', () => {
    expect(
      parseEnv({ NODE_ENV: 'production', PORT: '5200', LOG_LEVEL: 'warn' }),
    ).toMatchObject({ nodeEnv: 'production', port: 5200, logLevel: 'warn' });
  });
  it.each(['', ' ', '0', '-1', '65536', '1.5', 'invalid'])(
    'rejects invalid port %j',
    (port) => {
      expect(() => parseEnv({ PORT: port })).toThrow('PORT');
    },
  );
  it('rejects invalid environment and log level without exposing values', () => {
    expect(() => parseEnv({ NODE_ENV: 'private-value' })).toThrow('NODE_ENV');
    expect(() => parseEnv({ LOG_LEVEL: 'private-value' })).toThrow('LOG_LEVEL');
    expect(() => parseEnv({ NODE_ENV: 'private-value' })).not.toThrow(
      'private-value',
    );
  });
});
