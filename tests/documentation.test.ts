import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { openApiDocument } from '../src/modules/documentation/index.js';
import {
  requestSchema,
  type NotificationPublisher,
} from '../src/modules/notification-example/index.js';
import { RabbitMqError } from '../src/helper/rabbitmq/index.js';

const config = parseEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
const routes = ['task-assigned', 'task-commented'];
const prefix = '/api/v1/examples/notifications/';
type Operation = {
  requestBody: {
    content: {
      'application/json': {
        examples: Record<string, { value: Record<string, unknown> }>;
      };
    };
  };
  responses: Record<
    string,
    {
      content: {
        'application/json': {
          schema: {
            required: string[];
            properties: Record<string, { type: string; const?: unknown }>;
          };
        };
      };
    }
  >;
};
function operation(route: string): Operation {
  return (
    openApiDocument.paths as unknown as Record<string, { post: Operation }>
  )[prefix + route]!.post;
}
function assertResponse(
  route: string,
  status: number,
  body: Record<string, unknown>,
) {
  const schema =
    operation(route).responses[String(status)]!.content['application/json']
      .schema;
  expect(Object.keys(body).sort()).toEqual([...schema.required].sort());
  for (const [key, property] of Object.entries(schema.properties)) {
    expect(typeof body[key]).toBe(property.type);
    if ('const' in property) expect(body[key]).toBe(property.const);
  }
  if ('error' in body) {
    expect(Object.keys(body.error as object).sort()).toEqual([
      'code',
      'message',
    ]);
    expect(body.error).toEqual({
      code: expect.any(String),
      message: expect.any(String),
    });
  }
}
describe('Swagger documentation contract', () => {
  it.each(['test', 'production'])(
    'serves UI, local assets and spec without messaging in %s',
    async (nodeEnv) => {
      const app = createApp(
        parseEnv({ NODE_ENV: nodeEnv, LOG_LEVEL: 'silent' }),
      );
      await request(app)
        .get('/docs')
        .redirects(1)
        .expect(200)
        .expect(/id="swagger-ui"/);
      await request(app).get('/docs/swagger-ui.css').expect(200);
      await request(app).get('/docs/swagger-ui-bundle.js').expect(200);
      const init = await request(app)
        .get('/docs/swagger-ui-init.js')
        .expect(200);
      expect(init.text).toContain('"validatorUrl": null');
      expect(init.text).toContain('/openapi.json');
      const spec = await request(app).get('/openapi.json').expect(200);
      expect(spec.body.openapi).toBe('3.1.0');
      expect(spec.body.servers).toEqual([{ url: '/' }]);
      expect(Object.keys(spec.body.paths).sort()).toEqual(
        ['/health', ...routes.map((route) => prefix + route)].sort(),
      );
      const ids = Object.values(
        spec.body.paths as Record<
          string,
          Record<string, { operationId: string }>
        >,
      ).flatMap((path) => Object.values(path).map((op) => op.operationId));
      expect(new Set(ids).size).toBe(ids.length);
      await request(app)
        .get('/health')
        .expect(200)
        .expect({ status: 'ok', service: 'task-manage-app-example' });
    },
  );
  it('documents required fields, strict objects, nullable values and custom validation', async () => {
    const { body } = await request(createApp(config)).get('/openapi.json');
    const schema = body.components.schemas.NotificationExampleRequest;
    expect(schema.required.sort()).toEqual(
      [
        'actor',
        'project_id',
        'recipientUserIds',
        'title',
        'custom_badge',
      ].sort(),
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.title).toMatchObject({
      maxLength: 200,
      pattern: '\\S',
    });
    expect(schema.properties.recipientUserIds).toMatchObject({
      minItems: 1,
      maxItems: 100,
    });
    expect(schema.properties.recipientUserIds.description).toContain('casing');
    expect(schema.properties.type.description).toContain('BIRTHDAY');
    expect(schema.properties.type.description).toContain('SYSTEM');
    expect(JSON.stringify(schema.properties.type)).not.toContain('"enum"');
    expect(JSON.stringify(schema.properties.priority)).not.toContain('"enum"');
    expect(JSON.stringify(schema.properties.custom_badge)).toContain(
      '"additionalProperties":false',
    );
    expect(JSON.stringify(schema.properties.custom_badge)).not.toContain(
      '"enum"',
    );
  });
  it.each(routes)(
    'accepts every published example for %s through real HTTP validation',
    async (route) => {
      const publish = vi
        .fn<NotificationPublisher['publish']>()
        .mockResolvedValue();
      const app = createApp(config, undefined, { publish });
      expect(
        operation(route).requestBody.content['application/json'].examples
          .birthday!.value.type,
      ).toBe('BIRTHDAY');
      for (const example of Object.values(
        operation(route).requestBody.content['application/json'].examples,
      )) {
        expect(requestSchema.safeParse(example.value).success).toBe(true);
        const res = await request(app)
          .post(prefix + route)
          .send(example.value)
          .expect(202);
        assertResponse(route, 202, res.body);
        const sent = publish.mock.calls.at(-1)![0].message;
        expect(sent).toMatchObject({
          schemaVersion: 3,
          source: 'task-manage-app-example',
          type: 'notification.requested',
        });
        expect(sent.data).toMatchObject(example.value);
        expect(sent.data).toHaveProperty('summary', expect.any(String));
        expect(sent.data).toHaveProperty('scenario', 'task.' + route);
      }
      expect(publish).toHaveBeenCalledTimes(5);
    },
  );
  it('matches documented errors including parser and transport failures', async () => {
    const route = routes[0]!;
    const example =
      operation(route).requestBody.content['application/json'].examples.full!
        .value;
    const app = createApp(config);
    for (const [status, send] of [
      [400, {}],
      [413, { title: 'x'.repeat(1024 * 1024) }],
    ] as const) {
      const res = await request(app)
        .post(prefix + route)
        .send(send)
        .expect(status);
      assertResponse(route, status, res.body);
    }
    const malformed = await request(app)
      .post(prefix + route)
      .set('Content-Type', 'application/json')
      .send('{')
      .expect(400);
    assertResponse(route, 400, malformed.body);
    const disabled = await request(app)
      .post(prefix + route)
      .send(example)
      .expect(503);
    assertResponse(route, 503, disabled.body);
    for (const code of ['UNROUTABLE', 'DELIVERY_UNCERTAIN'] as const) {
      const publish = vi
        .fn<NotificationPublisher['publish']>()
        .mockRejectedValue(new RabbitMqError(code));
      const status = code === 'DELIVERY_UNCERTAIN' ? 504 : 503;
      const res = await request(createApp(config, undefined, { publish }))
        .post(prefix + route)
        .send(example)
        .expect(status);
      assertResponse(route, status, res.body);
      expect(res.body.error.code).toBe(code);
      expect(publish).toHaveBeenCalledTimes(1);
    }
  });
});
