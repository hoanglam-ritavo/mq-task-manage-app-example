import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  createNotificationClient,
  notificationEndpoint,
} from '../src/helper/rita-http/notification-client.js';
import { config, input, deferred } from './http-fixtures.js';
afterEach(() => vi.useRealTimers());
describe('Rita HTTP client', () => {
  it('keeps path prefix, exact key/body, no redirects or retries', async () => {
    const body = { ...input(), data: { scenario: 'fictional' } },
      transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ messageId: body.messageId, status: 'accepted' }),
          ),
        );
    const client = createNotificationClient(config, transport);
    await client.send(body);
    await client.stop();
    expect(transport).toHaveBeenCalledTimes(1);
    const [url, options] = transport.mock.calls[0]!;
    expect(url).toBe('https://rita.example.test/api/api-expose/notifications');
    expect(options).toMatchObject({
      method: 'POST',
      headers: {
        'X-API-Key': config.rita.apiKey,
        'Content-Type': 'application/json',
      },
      redirect: 'manual',
      body: JSON.stringify(body),
    });
    expect(notificationEndpoint('https://rita.example.test')).toBe(
      'https://rita.example.test/api-expose/notifications',
    );
  });
  it.each([
    [400, 400],
    [401, 502],
    [409, 409],
    [413, 413],
    [503, 503],
    [302, 502],
    [500, 502],
  ])(
    'maps upstream%s to%s without exposing raw errors',
    async (status, expected) => {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response('private upstream secret', { status }));
      const client = createNotificationClient(config, transport);
      await expect(client.send(input())).rejects.toMatchObject({
        status: expected,
      });
      expect(transport).toHaveBeenCalledTimes(1);
      try {
        await client.send(input());
      } catch (error) {
        expect(String(error)).not.toContain('private');
      }
      await client.stop();
    },
  );
  it.each(['malformed', 'wrong-id', 'wrong-status', 'empty', 'large'])(
    'treats%s success as unknown',
    async (kind) => {
      const body = input();
      let text =
        kind === 'malformed'
          ? 'not json'
          : JSON.stringify({
              messageId: kind === 'wrong-id' ? 'wrong' : body.messageId,
              status: kind === 'wrong-status' ? 'processed' : 'accepted',
            });
      if (kind === 'large') text = 'x'.repeat(16385);
      if (kind === 'empty') text = '';
      const client = createNotificationClient(
        config,
        vi.fn<typeof fetch>().mockResolvedValue(new Response(text)),
      );
      await expect(client.send(body)).rejects.toMatchObject({
        status: 502,
        code: 'RITA_OUTCOME_UNKNOWN',
      });
      await client.stop();
    },
  );
  it('maps network failure without printing credentials', async () => {
    const transport = vi
        .fn<typeof fetch>()
        .mockRejectedValue(new Error('private ' + config.rita.apiKey)),
      client = createNotificationClient(config, transport);
    await expect(client.send(input())).rejects.toMatchObject({
      status: 502,
      code: 'RITA_OUTCOME_UNKNOWN',
    });
    await client.stop();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('timeout aborts without resending, while shutdown still awaits actual pending work', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>(),
      transport = vi.fn<typeof fetch>().mockReturnValue(pending.promise),
      body = input(),
      client = createNotificationClient(config, transport, 10000);
    const work = expect(client.send(body)).rejects.toMatchObject({
      status: 504,
      code: 'RITA_OUTCOME_UNKNOWN',
    });
    await vi.advanceTimersByTimeAsync(10000);
    await work;
    expect((transport.mock.calls[0]![1]!.signal as AbortSignal).aborted).toBe(
      true,
    );
    let drained = false;
    const stop = client.stop().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    await expect(client.send(body)).rejects.toMatchObject({
      status: 503,
      code: 'STOPPING',
    });
    expect(transport).toHaveBeenCalledTimes(1);
    pending.resolve(
      new Response(
        JSON.stringify({ messageId: body.messageId, status: 'accepted' }),
      ),
    );
    await stop;
    expect(drained).toBe(true);
  });
  it('does not call transport when configuration is missing', async () => {
    const transport = vi.fn<typeof fetch>(),
      client = createNotificationClient({ ...config, rita: {} }, transport);
    await expect(client.send(input())).rejects.toMatchObject({
      status: 503,
      code: 'RITA_NOT_CONFIGURED',
    });
    expect(transport).not.toHaveBeenCalled();
    await client.stop();
  });
});
