import { notificationExamples } from './notification-examples.js';
import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { z } from 'zod';
import { requestSchema, templates } from '../notification-example/index.js';
import { profileEnvelope } from '../employee-profile/webhook.js';
import {
  profileViewSchema,
  profilePageSchema,
} from '../employee-profile/read.schema.js';
const service = 'task-manage-app-example';
const response = (description: string, schema: unknown, example?: unknown) => ({
  description,
  content: {
    'application/json': {
      schema,
      ...(example === undefined ? {} : { example }),
    },
  },
});
const profileExample = profileViewSchema.parse({
  revision: '9007199254740993',
  employee: {
    _id: '22222222-2222-4222-8222-222222222222',
    name: 'Fictional employee',
    email: 'fictional@example.test',
    employee_id: null,
    phone_number: null,
    active: true,
    is_developer: false,
    groups: 'EMPLOYEE',
    avatar: null,
    position: {
      text: null,
      parser: {
        group: '',
        company: '',
        department: '',
        board: '',
        region: '',
        store: '',
        warehouse: '',
        factory: '',
        workshop: '',
        showroom: '',
        center: '',
        cafe: '',
        others: [],
      },
    },
  },
});
const errorSchema = {
  type: 'object',
  properties: {
    messageId: { type: 'string', format: 'uuid' },
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' } },
    },
  },
  required: ['error'],
};
const errors = (codes: number[]) =>
  Object.fromEntries(
    codes.map((code) => [
      String(code),
      response(
        'Controlled error. No upstream body or credentials.',
        errorSchema,
      ),
    ]),
  );
const inputSchema = z.toJSONSchema(requestSchema, { unrepresentable: 'any' });
const dataSchema = inputSchema.properties?.data;
if (dataSchema && typeof dataSchema === 'object')
  Object.assign(dataSchema, {
    allOf: [
      {
        if: { properties: { type: { const: 'MESSAGE' } }, required: ['type'] },
        then: { required: ['group', 'message'] },
        else: {
          not: { anyOf: [{ required: ['group'] }, { required: ['message'] }] },
        },
      },
    ],
  });
// Enrich documentation only; keep the generated validation schema unchanged.
const fieldDescriptions = {
  type: 'Phân loại notification, không phải routing key. WARNING/MESSAGE/REPORT/REMINDER/UPDATED/SYSTEM. Thiếu/null/chuỗi không hỗ trợ (kể cả BIRTHDAY) → SYSTEM tại Rita ID. So khớp chính xác, không trim/uppercase.',
  priority:
    'Mức ưu tiên trình bày, không cam kết thứ tự giao nhận. LOW/MEDIUM/HIGH/URGENT. Thiếu/null/chuỗi không hỗ trợ → MEDIUM tại Rita ID. So khớp chính xác, không trim/uppercase.',
  custom_badge:
    'Nhãn trình bày nghiệp vụ, không phải trạng thái xử lý hoặc delivery. Bắt buộc có mặt: null nghĩa không hiển thị, hoặc {label,status}. label được lưu vào custom_badge; status vào custom_badge_status. label không trắng, tối đa 100 ký tự. status bắt buộc: DEFAULT/SUCCESS/WARNING/DANGEROUS; null/chuỗi không hỗ trợ → DEFAULT. So khớp chính xác, không trim/uppercase.',
  summary:
    'Chuỗi không trắng, tối đa 2000 ký tự nếu gửi. Bỏ field để dùng template của route; null hoặc chuỗi trắng không phải cách chọn default.',
};
if (dataSchema && typeof dataSchema === 'object') {
  for (const [field, description] of Object.entries(fieldDescriptions)) {
    const property = dataSchema.properties?.[field];
    if (property && typeof property === 'object')
      Object.assign(property, { description });
  }
}
export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: service,
    version: '0.2.0',
    description:
      'RAM-only HTTP demo. Restart loses profiles/revisions/receipts. No OAuth or durable delivery.',
  },
  components: {
    securitySchemes: {
      demoBearer: {
        type: 'http',
        scheme: 'bearer',
        description: 'Separate DEMO_API_TOKEN, never the Rita API key.',
      },
      webhookSignature: {
        type: 'apiKey',
        in: 'header',
        name: 'webhook-signature',
        description:
          'v1,<base64 HMAC-SHA256>; signed over id.timestamp.rawBody using the decoded whsec_ secret.',
      },
    },
  },
  paths: {
    '/api/v1/employee-profiles': {
      get: {
        operationId: 'listEmployeeProfiles',
        summary: 'Read profiles currently applied in RAM',
        description:
          'Includes inactive employees. Sorted by lowercase employee UUID. Unknown/repeated/structured query parameters or unsafe pagination offset return 400. Restart loses state. No bootstrap/backfill or proof of complete synchronization. Cache-Control: no-store.',
        security: [{ demoBearer: [] }],
        parameters: [
          {
            name: 'page',
            in: 'query',
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: Number.MAX_SAFE_INTEGER,
              default: 1,
            },
          },
          {
            name: 'pageSize',
            in: 'query',
            schema: { type: 'integer', enum: [10, 20, 50], default: 10 },
          },
        ],
        responses: {
          '200': {
            ...response(
              'Current RAM page; empty when beyond stored profiles.',
              z.toJSONSchema(profilePageSchema),
              { items: [profileExample], total: 1, page: 1, pageSize: 10 },
            ),
            headers: { 'Cache-Control': { schema: { const: 'no-store' } } },
          },
          ...errors([400, 401, 503]),
        },
      },
    },
    '/api/v1/employee-profiles/{userId}': {
      get: {
        operationId: 'getEmployeeProfile',
        summary: 'Read one current RAM profile',
        description:
          'Case-insensitive UUID lookup. PROFILE_NOT_FOUND means not in this process. No Rita ID request. Cache-Control: no-store.',
        security: [{ demoBearer: [] }],
        parameters: [
          {
            name: 'userId',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
            example: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          },
        ],
        responses: {
          '200': {
            ...response(
              'Current revision as a decimal string and full employee projection.',
              z.toJSONSchema(profileViewSchema),
              profileExample,
            ),
            headers: { 'Cache-Control': { schema: { const: 'no-store' } } },
          },
          ...errors([400, 401, 404, 503]),
        },
      },
    },
    '/health': {
      get: {
        operationId: 'health',
        responses: {
          '200': response(
            'HTTP liveness only; integrations may be unconfigured.',
            {
              type: 'object',
              required: ['status', 'service'],
              properties: {
                status: { const: 'ok' },
                service: { const: service },
              },
            },
          ),
        },
      },
    },
    '/api/v1/webhooks/rita-id/employee-profile': {
      post: {
        operationId: 'receiveEmployeeProfile',
        summary: 'Apply signed profile to RAM only',
        description:
          'Raw body max256 KiB. Timestamp within5 minutes. Exactly one employee; bigint revision string. Response does not promise durable storage. No demo Bearer token required.',
        security: [{ webhookSignature: [] }],
        parameters: [
          {
            name: 'webhook-id',
            in: 'header',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'webhook-timestamp',
            in: 'header',
            required: true,
            schema: { type: 'string', pattern: '^\\d{1,12}$' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: z.toJSONSchema(profileEnvelope, {
                unrepresentable: 'any',
              }),
            },
          },
        },
        responses: {
          '200': response('Applied, duplicate or stale in this process only.', {
            type: 'object',
            additionalProperties: false,
            required: ['messageId', 'status'],
            properties: {
              messageId: { type: 'string', format: 'uuid' },
              status: { enum: ['applied', 'duplicate', 'stale'] },
            },
          }),
          ...errors([400, 401, 409, 413, 503]),
        },
      },
    },
    ...Object.fromEntries(
      Object.entries(templates).map(([route, summary]) => [
        '/api/v1/examples/notifications/' + route,
        {
          post: {
            operationId: 'notify_' + route.replaceAll('-', '_'),
            summary,
            description: `Scenario cố định: task.${route}. Caller không gửi scenario/Project/source. Bỏ field summary để dùng template: ${summary}; có thể gửi summary riêng không trắng. Chọn full để xem payload đầy đủ; đây không phải policy mặc định. Dùng Bearer DEMO_API_TOKEN, không dùng API key Rita ID trong Swagger. simulation:true vẫn gọi Rita ID thật, không phải dry-run. Accepted không có nghĩa người nhận đã đọc. Retry thủ công cùng messageId/occurredAt/nội dung; đổi mẫu với messageId đã accepted có thể trả 409. Không retry tự động.`,
            security: [{ demoBearer: [] }],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: inputSchema,
                  examples:
                    notificationExamples[route as keyof typeof templates],
                },
              },
            },
            responses: {
              '200': response(
                'Rita accepted after its persistence commit; not user read.',
                {
                  type: 'object',
                  additionalProperties: false,
                  required: ['messageId', 'status', 'simulation'],
                  properties: {
                    messageId: { type: 'string', format: 'uuid' },
                    status: { const: 'accepted' },
                    simulation: { const: true },
                  },
                },
              ),
              ...errors([400, 401, 409, 413, 502, 503, 504]),
            },
          },
        },
      ]),
    ),
  },
};
export function createDocumentationRouter() {
  const router = Router();
  router.get('/openapi.json', (_req, res) => res.json(openApiDocument));
  router.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(undefined, {
      swaggerOptions: {
        url: '/openapi.json',
        validatorUrl: null,
        supportedSubmitMethods: ['get', 'post'],
      },
      customSiteTitle: service + ' API docs',
    }),
  );
  return router;
}
