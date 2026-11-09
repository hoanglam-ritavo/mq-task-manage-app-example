import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../src/app.js';
import {
  ProfileStore,
  profileEnvelope,
} from '../src/modules/employee-profile/webhook.js';
import {
  profileViewSchema,
  profilePageSchema,
} from '../src/modules/employee-profile/read.schema.js';
import {
  config,
  token,
  profileEvent,
  signature,
  userId,
  webhookPath,
} from './http-fixtures.js';

const base = '/api/v1/employee-profiles';
const get = (app: ReturnType<typeof createApp>, suffix = '') =>
  request(app)
    .get(base + suffix)
    .auth(token, { type: 'bearer' });
const send = (app: ReturnType<typeof createApp>, event = profileEvent()) => {
  const body = JSON.stringify(event);
  return request(app)
    .post(webhookPath)
    .set('Content-Type', 'application/json')
    .set(signature(body, event.messageId))
    .send(body);
};
const seed = (store: ProfileStore, id: string) => {
  const event = profileEvent();
  event.data.employees[0]!._id = id;
  store.apply(profileEnvelope.parse(event), Buffer.from(JSON.stringify(event)));
};

describe('Read the webhook RAM store', () => {
  it.each(['?page=bad&unknown=x', '/invalid-uuid'])(
    'authenticates before validation: %s',
    async (suffix) => {
      const app = createApp(config);
      await request(app)
        .get(base + suffix)
        .expect(401);
      await request(app)
        .get(base + suffix)
        .auth('wrong', { type: 'bearer' })
        .expect(401);
      await get(
        createApp({ ...config, demoApiToken: undefined }),
        suffix,
      ).expect(503);
      await request(app)
        .get(base + suffix)
        .set('X-API-Key', config.rita.apiKey!)
        .expect(401);
      await request(app)
        .get(base + suffix)
        .auth(config.rita.webhookSecret!, { type: 'bearer' })
        .expect(401);
    },
  );
  it('returns an empty default page and no-store without calling transport', async () => {
    const client = { send: vi.fn(), stop: vi.fn() };
    const response = await get(createApp(config, undefined, client)).expect(
      200,
    );
    expect(response.body).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(client.send).not.toHaveBeenCalled();
    expect(client.stop).not.toHaveBeenCalled();
  });
  it.each([
    '?search=x',
    '?page=1&page=2',
    '?pageSize=10&pageSize=10',
    '?page[]=1',
    '?page[x]=1',
    '?pageSize[]=10',
    '?pageSize[x]=10',
    '?page=',
    '?page=0',
    '?page=-1',
    '?page=1.5',
    '?page=1e2',
    '?page=NaN',
    '?page=Infinity',
    '?page=9007199254740992',
    '?page=9007199254740991',
    '?page=900719925474101&pageSize=10',
    '?pageSize=1',
    '?pageSize=100',
    '?pageSize=',
    '?pageSize=10.0',
    '?pageSize=010',
    '?page=%201',
  ])('rejects invalid query %s', async (query) => {
    const response = await get(createApp(config), query).expect(400);
    expect(response.body.error.code).toBe('INVALID_PROFILE_QUERY');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('paginates and sorts normalized UUIDs independently of receipt count/insertion order', async () => {
    const store = new ProfileStore();
    const ids = Array.from(
      { length: 23 },
      (_, i) =>
        (i + 1).toString(16).padStart(8, '0') + '-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    );
    for (const id of [...ids].reverse()) seed(store, id.toUpperCase());
    const extraReceipt = profileEvent('1');
    extraReceipt.data.employees[0]!._id = ids[0]!;
    store.apply(
      profileEnvelope.parse(extraReceipt),
      Buffer.from(JSON.stringify(extraReceipt)),
    );
    const app = createApp(config, undefined, undefined, store);
    for (const pageSize of [10, 20, 50]) {
      const response = await get(app, '?page=2&pageSize=' + pageSize).expect(
        200,
      );
      expect(response.body).toMatchObject({ total: 23, page: 2, pageSize });
      expect(
        response.body.items.map((v: { employee: { _id: string } }) =>
          v.employee._id.toLowerCase(),
        ),
      ).toEqual(ids.slice(pageSize, pageSize * 2));
      expect(profilePageSchema.safeParse(response.body).success).toBe(true);
    }
    const hugePage = await get(app, '?page=900719925474100&pageSize=10').expect(
      200,
    );
    expect(hugePage.body.items).toEqual([]);
    expect(hugePage.body.total).toBe(23);
  });
  it('validates UUIDs and returns a controlled missing-profile error', async () => {
    const app = createApp(config);
    expect((await get(app, '/not-a-uuid').expect(400)).body.error.code).toBe(
      'INVALID_PROFILE_ID',
    );
    const response = await get(app, '/' + userId).expect(404);
    expect(response.body.error.code).toBe('PROFILE_NOT_FOUND');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('shows full nullable/inactive employee projection with string revision, without internals', async () => {
    const client = { send: vi.fn(), stop: vi.fn() };
    const app = createApp(config, undefined, client);
    const event = profileEvent();
    event.data.employees[0]!._id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    event.data.employees[0]!.active = false;
    event.data.employees[0]!.position.parser.others = ['Fictional position'];
    await send(app, event).expect(200);
    const expected = {
      revision: event.revision,
      employee: event.data.employees[0],
    };
    const detail = await get(
      app,
      '/' + event.data.employees[0]!._id.toUpperCase(),
    ).expect(200);
    expect(detail.body).toEqual(expected);
    expect(profileViewSchema.safeParse(detail.body).success).toBe(true);
    expect(detail.headers['cache-control']).toBe('no-store');
    expect((await get(app).expect(200)).body.items).toEqual([expected]);
    expect(client.send).not.toHaveBeenCalled();
    expect(client.stop).not.toHaveBeenCalled();
  });
  it('reflects only applied webhook revisions through list/detail', async () => {
    const app = createApp(config);
    const first = profileEvent();
    await send(app, first).expect(200);
    await send(app, first).expect(200);
    await send(app, {
      ...first,
      messageId: randomUUID(),
      revision: '1',
    }).expect(200);
    const conflict = structuredClone(first);
    conflict.messageId = randomUUID();
    conflict.data.employees[0]!.name = 'Conflicting profile';
    await send(app, conflict).expect(409);
    const unchanged = (await get(app).expect(200)).body;
    expect(unchanged.total).toBe(1);
    expect(unchanged.items).toEqual([
      { revision: first.revision, employee: first.data.employees[0] },
    ]);
    const next = structuredClone(conflict);
    next.messageId = randomUUID();
    next.revision = (BigInt(first.revision) + 1n).toString();
    await send(app, next).expect(200);
    const detail = (await get(app, '/' + userId).expect(200)).body;
    expect(detail).toEqual({
      revision: next.revision,
      employee: next.data.employees[0],
    });
    expect((await get(app).expect(200)).body.items).toEqual([detail]);
  });
  it('clones public projections and preserves snapshot/revision/receipts on read', () => {
    const store = new ProfileStore();
    const event = profileEvent(),
      body = Buffer.from(JSON.stringify(event));
    store.apply(profileEnvelope.parse(event), body);
    const before = store.snapshot(userId);
    const page = store.list(1, 10);
    page.items[0]!.employee.name = 'Changed outside';
    const detail = store.get(userId)!;
    detail.employee.position.parser.others.push('Changed outside');
    expect(store.snapshot(userId)).toEqual(before);
    expect(before?.revision).toBe(BigInt(event.revision));
    expect(before?.hash).toEqual(expect.any(String));
    expect(store.apply(profileEnvelope.parse(event), body)).toBe('duplicate');
    expect(store.list(1, 10).total).toBe(1);
  });
  it('isolates app stores and starts empty after a new instance', async () => {
    const app = createApp(config),
      other = createApp(config);
    await send(app).expect(200);
    expect((await get(app).expect(200)).body.total).toBe(1);
    expect((await get(other).expect(200)).body.items).toEqual([]);
    expect((await get(createApp(config)).expect(200)).body.items).toEqual([]);
  });
  it('logs only fixed labels for list/detail and never response/query/UUID/credentials', async () => {
    const store = new ProfileStore();
    seed(store, userId);
    let output = '';
    const logger = pino(
      { level: 'info' },
      new Writable({
        write(chunk, _encoding, callback) {
          output += String(chunk);
          callback();
        },
      }),
    );
    const app = createApp(config, logger, undefined, store);
    await get(app).expect(200);
    await get(app, '/' + userId).expect(200);
    await get(app, '/arbitrary-secret?token=query-secret').expect(400);
    const records = output
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { path: string });
    expect(records.map((v) => v.path)).toEqual([
      base,
      base + '/:userId',
      base + '/:userId',
    ]);
    for (const value of [
      userId,
      token,
      'query-secret',
      'arbitrary-secret',
      'Fictional employee',
      'fictional@example.test',
    ])
      expect(output).not.toContain(value);
  });
});
