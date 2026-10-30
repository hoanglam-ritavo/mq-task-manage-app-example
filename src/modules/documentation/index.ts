import { Router } from 'express';
import swaggerUi from 'swagger-ui-express';
import { z } from 'zod';
import { requestSchema, templates } from '../notification-example/index.js';

const service = 'task-manage-app-example';
const uuid = { type: 'string', format: 'uuid' };
const error = {
  type: 'object',
  additionalProperties: false,
  required: ['code', 'message'],
  properties: { code: { type: 'string' }, message: { type: 'string' } },
};
const errorBody = {
  type: 'object',
  additionalProperties: false,
  required: ['error'],
  properties: { error },
};
const transportError = {
  type: 'object',
  additionalProperties: false,
  required: ['messageId', 'error'],
  properties: { messageId: uuid, error },
};
const confirmed = {
  type: 'object',
  additionalProperties: false,
  required: ['messageId', 'status', 'simulation'],
  properties: {
    messageId: uuid,
    status: { type: 'string', const: 'broker-confirmed' },
    simulation: { type: 'boolean', const: true },
  },
};
function response(description: string, schema: object) {
  return { description, content: { 'application/json': { schema } } };
}
const inputSchema = z.toJSONSchema(requestSchema, {
  io: 'input',
  target: 'draft-2020-12',
});
export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: service + ' — Notification examples',
    version: '2.0.0',
    description:
      'API mô phỏng pipeline 2, chưa có auth và không tạo đơn hàng/task thật. Actor, project và người nhận chỉ kiểm tra cấu trúc UUID, không xác minh tồn tại hoặc quyền. Chỉ dùng trong môi trường demo có kiểm soát. UUID và tên mẫu là hư cấu. Rita ID nhận, chuẩn hóa enum rồi log; không lưu notification. Có thể dán request JSON từ generator local vào Try it out. Không tự retry: gọi lại có thể tạo message trùng.',
  },
  servers: [{ url: '/' }],
  tags: [{ name: 'Notification examples' }, { name: 'Health' }],
  paths: {
    '/health': {
      get: {
        operationId: 'getHealth',
        tags: ['Health'],
        summary: 'Kiểm tra HTTP liveness',
        responses: {
          '200': response(
            'HTTP đang hoạt động; không phản ánh trạng thái broker.',
            {
              type: 'object',
              additionalProperties: false,
              required: ['status', 'service'],
              properties: {
                status: { type: 'string', const: 'ok' },
                service: { type: 'string', const: service },
              },
            },
          ),
        },
      },
    },
    ...Object.fromEntries(
      Object.entries(templates).map(([route, summary]) => {
        const full = {
          actor: '11111111-1111-4111-8111-111111111111',
          recipientUserIds: ['22222222-2222-4222-8222-222222222222'],
          project_id: '33333333-3333-4333-8333-333333333333',
          title: summary,
          summary:
            'Nhân viên Demo A thực hiện tình huống minh họa; không phải nghiệp vụ thật.',
          type: 'SYSTEM',
          priority: 'MEDIUM',
          custom_badge: { label: 'Demo', status: 'SUCCESS' },
        };
        return [
          '/api/v1/examples/notifications/' + route,
          {
            post: {
              operationId: route.replace(/-([a-z])/g, (_, letter: string) =>
                letter.toUpperCase(),
              ),
              tags: ['Notification examples'],
              summary,
              description:
                'Nếu thiếu summary, producer dùng: ' +
                summary +
                '. Producer tự tạo scenario, source, messageId, occurredAt và schemaVersion=2; không gửi các field này trong body. Chờ Rita ID consumer ready trước khi gửi. 202 chỉ là broker confirm, không chứng minh Rita ID đã log.',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/NotificationExampleRequest',
                    },
                    examples: {
                      full: {
                        summary: 'Payload đầy đủ — dữ liệu hư cấu',
                        value: full,
                      },
                      system: {
                        summary: 'Actor/badge null và summary mặc định',
                        value: {
                          actor: null,
                          recipientUserIds: full.recipientUserIds,
                          project_id: full.project_id,
                          title: summary,
                          custom_badge: null,
                        },
                      },
                      birthday: {
                        summary:
                          'BIRTHDAY nội bộ — backend chuyển thành SYSTEM',
                        value: { ...full, type: 'BIRTHDAY' },
                      },
                      fallback: {
                        summary: 'Chuỗi enum chưa hỗ trợ — Rita ID fallback',
                        value: {
                          ...full,
                          type: 'UNKNOWN_DEMO',
                          priority: 'UNKNOWN_DEMO',
                          custom_badge: {
                            label: 'Demo',
                            status: 'UNKNOWN_DEMO',
                          },
                        },
                      },
                    },
                  },
                },
              },
              responses: {
                '202': response(
                  'Broker đã confirm; chưa chứng minh consumer xử lý thành công.',
                  confirmed,
                ),
                '400': response(
                  'INVALID_NOTIFICATION_REQUEST hoặc INVALID_JSON; chưa publish.',
                  errorBody,
                ),
                '413': response(
                  'PAYLOAD_TOO_LARGE: body vượt giới hạn 1 MiB.',
                  errorBody,
                ),
                '503': response(
                  'DISABLED, UNAVAILABLE, BLOCKED, BACKPRESSURE, IN_FLIGHT_LIMIT, STOPPING, UNROUTABLE, NACKED hoặc PUBLISH_FAILED; không tự resend.',
                  transportError,
                ),
                '504': response(
                  'DELIVERY_UNCERTAIN: message có thể đã được gửi. Không tự retry.',
                  transportError,
                ),
              },
            },
          },
        ];
      }),
    ),
  },
  components: { schemas: { NotificationExampleRequest: inputSchema } },
};

export function createDocumentationRouter() {
  const router = Router();
  router.get('/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
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
