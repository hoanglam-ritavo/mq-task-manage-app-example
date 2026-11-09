import { openApiDocument } from '../src/modules/documentation/index.js';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { templates } from '../src/modules/notification-example/index.js';
import { AppError } from '../src/shared/errors/app-error.js';
import type { NotificationClient } from '../src/helper/rita-http/notification-client.js';
import { config, token, input, userId, deferred } from './http-fixtures.js';
const base = '/api/v1/examples/notifications/';
const routes = Object.keys(templates);
const fixture = () => {
  const send = vi.fn<NotificationClient['send']>().mockResolvedValue();
  return {
    send,
    app: createApp(config, undefined, { send, stop: async () => undefined }),
  };
};
describe('Notification HTTP demo', () => {
  it.each(routes)(
    'maps %s to an authenticated endpoint request',
    async (route) => {
      const f = fixture(),
        body = input();
      const response = await request(f.app)
        .post(base + route)
        .auth(token, { type: 'bearer' })
        .send(body)
        .expect(200);
      expect(response.body).toEqual({
        messageId: body.messageId,
        status: 'accepted',
        simulation: true,
      });
      expect(f.send).toHaveBeenCalledExactlyOnceWith({
        ...body,
        data: {
          ...body.data,
          scenario: 'task.' + route,
          summary: templates[route as keyof typeof templates],
        },
      });
      expect(f.send.mock.calls[0]![0]).not.toHaveProperty('source');
      expect(f.send.mock.calls[0]![0].data).not.toHaveProperty('project_id');
    },
  );
  it('keeps overrides and enum strings for Rita normalization', async () => {
    const f = fixture(),
      body = input();
    await request(f.app)
      .post(base + routes[0])
      .auth(token, { type: 'bearer' })
      .send({
        ...body,
        correlationId: 'demo-correlation',
        data: {
          ...body.data,
          summary: 'Override',
          type: 'BIRTHDAY',
          priority: 'unknown',
          custom_badge: { label: 'Badge', status: null },
        },
      })
      .expect(200);
    expect(f.send.mock.calls[0]![0].data).toMatchObject({
      type: 'BIRTHDAY',
      priority: 'unknown',
      summary: 'Override',
    });
  });
  it.each([
    { actor: undefined },
    { actor: 'bad' },
    { title: undefined },
    { title: ' ' },
    { title: 'x'.repeat(201) },
    { summary: 'x'.repeat(2001) },
    { recipientUserIds: [] },
    { recipientUserIds: ['bad'] },
    { recipientUserIds: [userId, userId.toUpperCase()] },
    { recipientUserIds: Array.from({ length: 101 }, () => randomUUID()) },
    { custom_badge: undefined },
    { custom_badge: { label: 'Badge' } },
    { custom_badge: { status: null } },
    { custom_badge: { label: ' ', status: null } },
    { custom_badge: { label: 'Badge', status: 3 } },
    { custom_badge: { label: 'Badge', status: null, extra: true } },
    { custom_badge: 'invalid' },
    { type: {} },
    { priority: 3 },
    { priority: 'x'.repeat(101) },
    { project_id: userId },
    { scenario: 'forged' },
    { source: 'forged' },
    { birthdayOccurrence: '2026-11-07' },
    { custom_badge_status: [] },
  ])('rejects invalid data %j before sending', async (patch) => {
    const f = fixture(),
      body = input();
    await request(f.app)
      .post(base + routes[0])
      .auth(token, { type: 'bearer' })
      .send({ ...body, data: { ...body.data, ...patch } })
      .expect(400);
    expect(f.send).not.toHaveBeenCalled();
  });
  it.each([
    { messageId: undefined },
    { messageId: 'bad' },
    { occurredAt: undefined },
    { occurredAt: '2026-02-30T00:00:00Z' },
    { correlationId: ' ' },
    { source: 'forged' },
    { type: 'event' },
    { schemaVersion: 3 },
    { project_id: userId },
  ])('rejects invalid wrapper %j', async (patch) => {
    const f = fixture();
    await request(f.app)
      .post(base + routes[0])
      .auth(token, { type: 'bearer' })
      .send({ ...input(), ...patch })
      .expect(400);
    expect(f.send).not.toHaveBeenCalled();
  });
  it('authenticates before JSON validation and never forwards either wrong credential', async () => {
    const f = fixture();
    for (const auth of [undefined, 'Bearer wrong', config.rita.apiKey]) {
      const r = request(f.app)
        .post(base + routes[0])
        .set('Content-Type', 'application/json');
      if (auth) r.set('Authorization', auth);
      await r.send('{broken').expect(401);
    }
    expect(f.send).not.toHaveBeenCalled();
    await request(createApp({ ...config, demoApiToken: undefined }))
      .post(base + routes[0])
      .send(input())
      .expect(503);
  });
  it('awaits acceptance and manually repeats with the same identity', async () => {
    const f = fixture(),
      entered = deferred<void>(),
      release = deferred<void>(),
      body = input();
    f.send.mockImplementation(async () => {
      entered.resolve();
      await release.promise;
    });
    let done = false;
    const work = request(f.app)
      .post(base + routes[0])
      .auth(token, { type: 'bearer' })
      .send(body)
      .then((r) => {
        done = true;
        return r;
      });
    await entered.promise;
    expect(done).toBe(false);
    release.resolve();
    expect((await work).status).toBe(200);
    await request(f.app)
      .post(base + routes[0])
      .auth(token, { type: 'bearer' })
      .send(body);
    expect(f.send.mock.calls[0]).toEqual(f.send.mock.calls[1]);
  });
  it.each([400, 409, 413, 502, 503, 504])(
    'returns a controlled%s failure with stable identity',
    async (status) => {
      const f = fixture(),
        body = input();
      f.send.mockRejectedValue(
        new AppError(status, 'CONTROLLED', 'Controlled failure.'),
      );
      const r = await request(f.app)
        .post(base + routes[0])
        .auth(token, { type: 'bearer' })
        .send(body)
        .expect(status);
      expect(r.body).toEqual({
        messageId: body.messageId,
        error: { code: 'CONTROLLED', message: 'Controlled failure.' },
      });
      expect(f.send).toHaveBeenCalledTimes(1);
    },
  );
  it('sanitizes arbitrary exceptions and reports absent Rita settings without connections', async () => {
    const f = fixture();
    f.send.mockRejectedValue(new Error('private-key-response'));
    const r = await request(f.app)
      .post(base + routes[0])
      .auth(token, { type: 'bearer' })
      .send(input())
      .expect(502);
    expect(JSON.stringify(r.body)).not.toContain('private');
    await request(createApp({ ...config, rita: {} }))
      .post(base + routes[0])
      .auth(token, { type: 'bearer' })
      .send(input())
      .expect(503);
  });
  it('keeps conditional MESSAGE context strict', async () => {
    const context = {
      group: { key: 'conversation:1', type: 'COUPLE', name: null },
      message: { id: 'm1', text: 'Preview', sentAt: '2026-11-07T00:00:00Z' },
    };
    for (const patch of [
      { type: 'MESSAGE' },
      { type: 'MESSAGE', group: context.group },
      { type: 'MESSAGE', message: context.message },
      { ...context, type: 'SYSTEM' },
      {
        ...context,
        type: 'MESSAGE',
        message: { ...context.message, sentAt: 'invalid' },
      },
      { ...context, type: 'MESSAGE', group: { ...context.group, extra: true } },
    ]) {
      const f = fixture(),
        body = input();
      await request(f.app)
        .post(base + routes[0])
        .auth(token, { type: 'bearer' })
        .send({ ...body, data: { ...body.data, ...patch } })
        .expect(400);
      expect(f.send).not.toHaveBeenCalled();
    }
    const f = fixture(),
      body = input();
    await request(f.app)
      .post(base + routes[0])
      .auth(token, { type: 'bearer' })
      .send({ ...body, data: { ...body.data, type: 'MESSAGE', ...context } })
      .expect(200);
    expect(f.send.mock.calls[0]![0].data).toMatchObject(context);
  });
});

describe('Published Swagger requests through HTTP', () => {
  const document = JSON.parse(JSON.stringify(openApiDocument));
  for (const route of routes) {
    const examples =
      document.paths[base + route].post.requestBody.content['application/json']
        .examples;
    for (const name of ['full', 'minimal', 'message']) {
      it(
        route + ' forwards ' + name + ' without dropping caller fields',
        async () => {
          const f = fixture();
          const body = structuredClone(examples[name].value);
          await request(f.app)
            .post(base + route)
            .auth(token, { type: 'bearer' })
            .send(body)
            .expect(200);
          expect(f.send).toHaveBeenCalledExactlyOnceWith({
            ...body,
            data: {
              ...body.data,
              scenario: 'task.' + route,
              summary:
                body.data.summary ?? templates[route as keyof typeof templates],
            },
          });
        },
      );
    }
  }
});
