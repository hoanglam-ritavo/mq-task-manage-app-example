import { readFileSync } from 'node:fs';
import {
  profileViewSchema,
  profilePageSchema,
} from '../src/modules/employee-profile/read.schema.js';
import { profileEnvelope } from '../src/modules/employee-profile/webhook.js';

import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { openApiDocument } from '../src/modules/documentation/index.js';
import {
  requestSchema,
  templates,
} from '../src/modules/notification-example/index.js';
import { config, input } from './http-fixtures.js';
describe('OpenAPI HTTP contract', () => {
  it('keeps every business demo and standalone fictional file example', () => {
    expect(Object.keys(templates).sort()).toEqual([
      'task-assigned',
      'task-commented',
    ]);
    expect(
      requestSchema.safeParse(
        JSON.parse(
          readFileSync(
            new URL('../examples/notification.json', import.meta.url),
            'utf8',
          ),
        ),
      ).success,
    ).toBe(true);
    expect(
      profileEnvelope.safeParse(
        JSON.parse(
          readFileSync(
            new URL('../examples/profile-event.json', import.meta.url),
            'utf8',
          ),
        ),
      ).success,
    ).toBe(true);
  });
  it.each(['test', 'production'] as const)(
    'serves docs without credentials in%s',
    async (nodeEnv) => {
      const app = createApp({ ...config, nodeEnv });
      await request(app).get('/docs/').expect(200);
      expect(
        (await request(app).get('/openapi.json').expect(200)).body.openapi,
      ).toBe('3.1.0');
    },
  );
  it('inventories every operation, security boundary and volatile guarantee', () => {
    const document = JSON.parse(JSON.stringify(openApiDocument));
    expect(Object.keys(document.paths).sort()).toEqual(
      [
        '/health',
        '/api/v1/webhooks/rita-id/employee-profile',
        '/api/v1/employee-profiles',
        '/api/v1/employee-profiles/{userId}',
        ...Object.keys(templates).map(
          (r) => '/api/v1/examples/notifications/' + r,
        ),
      ].sort(),
    );
    expect(document.info.description).toContain('Restart loses');
    expect(document.paths['/health'].get.security).toBeUndefined();
    for (const route of Object.keys(templates)) {
      const op = document.paths['/api/v1/examples/notifications/' + route].post;
      expect(op.security).toEqual([{ demoBearer: [] }]);
      expect(Object.keys(op.responses).sort()).toEqual([
        '200',
        '400',
        '401',
        '409',
        '413',
        '502',
        '503',
        '504',
      ]);
      expect(
        requestSchema.safeParse(
          op.requestBody.content['application/json'].example,
        ).success,
      ).toBe(true);
    }
    const webhook =
      document.paths['/api/v1/webhooks/rita-id/employee-profile'].post;
    expect(webhook.security).toEqual([{ webhookSignature: [] }]);
    expect(webhook.parameters.map((v: { name: string }) => v.name)).toEqual([
      'webhook-id',
      'webhook-timestamp',
    ]);
  });
  it('documents strict wrapper, stable identities and server-owned fields', () => {
    const document = JSON.parse(JSON.stringify(openApiDocument)),
      route = Object.keys(templates)[0]!,
      schema =
        document.paths['/api/v1/examples/notifications/' + route].post
          .requestBody.content['application/json'].schema;
    expect(schema.required).toEqual(['messageId', 'occurredAt', 'data']);
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.data.additionalProperties).toBe(false);
    expect(schema.properties.data.required).toEqual([
      'actor',
      'recipientUserIds',
      'title',
      'custom_badge',
    ]);
    for (const key of [
      'project_id',
      'scenario',
      'source',
      'birthdayOccurrence',
    ])
      expect(schema.properties.data.properties).not.toHaveProperty(key);
    expect(schema.properties.data.allOf).toHaveLength(1);
    expect(requestSchema.parse(input()).messageId).toBeDefined();
  });
});

describe('Profile read OpenAPI contract', () => {
  it('documents both protected GETs, schemas, errors, pagination and no-store', async () => {
    const doc = (
      await request(createApp(config)).get('/openapi.json').expect(200)
    ).body;
    const list = doc.paths['/api/v1/employee-profiles'].get;
    const detail = doc.paths['/api/v1/employee-profiles/{userId}'].get;
    expect(list.operationId).toBe('listEmployeeProfiles');
    expect(detail.operationId).toBe('getEmployeeProfile');
    expect(list.parameters.map((v: { name: string }) => v.name)).toEqual([
      'page',
      'pageSize',
    ]);
    expect(list.parameters[0].schema).toMatchObject({
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
      default: 1,
    });
    expect(list.parameters[1].schema).toEqual({
      type: 'integer',
      enum: [10, 20, 50],
      default: 10,
    });
    expect(detail.parameters[0]).toMatchObject({
      name: 'userId',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    });
    expect(Object.keys(list.responses)).toEqual(['200', '400', '401', '503']);
    expect(Object.keys(detail.responses)).toEqual([
      '200',
      '400',
      '401',
      '404',
      '503',
    ]);
    for (const op of [list, detail]) {
      expect(op.security).toEqual([{ demoBearer: [] }]);
      expect(op.responses['200'].headers['Cache-Control'].schema.const).toBe(
        'no-store',
      );
    }
    expect(
      profileViewSchema.safeParse(
        detail.responses['200'].content['application/json'].example,
      ).success,
    ).toBe(true);
    expect(
      profilePageSchema.safeParse(
        list.responses['200'].content['application/json'].example,
      ).success,
    ).toBe(true);
    const item = detail.responses['200'].content['application/json'].schema;
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(['revision', 'employee']);
    expect(item.properties.revision.type).toBe('string');
    expect(
      list.responses['200'].content['application/json'].schema.properties.items
        .items,
    ).toMatchObject({ properties: item.properties });
    const employee =
      doc.paths['/api/v1/webhooks/rita-id/employee-profile'].post.requestBody
        .content['application/json'].schema.properties.data.properties.employees
        .items;
    expect(item.properties.employee).toEqual(employee);
  });
});
