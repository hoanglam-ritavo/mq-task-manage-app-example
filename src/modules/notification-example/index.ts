import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  RabbitMqError,
  type MessageEnvelope,
} from '../../helper/rabbitmq/index.js';

export const NOTIFICATION_EXCHANGE = 'rita.notification.events';
export const NOTIFICATION_TYPE = 'notification.requested';
export interface NotificationPublisher {
  publish(input: {
    exchange: string;
    routingKey: string;
    message: MessageEnvelope;
  }): Promise<void>;
}
const nonblank = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0)
    .meta({ description: 'Chuỗi không trắng; không tự trim.', pattern: '\\S' });
const enumInput = z.string().max(100).nullable().optional();
export const requestSchema = z.strictObject({
  actor: z
    .uuid()
    .nullable()
    .describe(
      'UUID Rita ID user hoặc null cho hành động hệ thống; bắt buộc có mặt.',
    ),
  project_id: z
    .uuid()
    .describe('UUID Project của Rita ID; không phải ID đơn hàng/task.'),
  recipientUserIds: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .refine(
      (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
    )
    .describe(
      '1–100 UUID Rita ID user; không trùng kể cả khác casing. Chỉ kiểm tra cấu trúc.',
    ),
  title: nonblank(200),
  summary: nonblank(2000).optional(),
  custom_badge: z
    .strictObject({
      label: nonblank(100),
      status: z
        .string()
        .max(100)
        .nullable()
        .describe(
          'Nhận diện DEFAULT, SUCCESS, WARNING, DANGEROUS. Null hoặc chuỗi không hỗ trợ → DEFAULT tại Rita ID. So khớp chính xác; không trim/uppercase.',
        ),
    })
    .nullable(),
  type: enumInput.describe(
    'Nhận diện WARNING, MESSAGE, REPORT, REMINDER, UPDATED, SYSTEM. BIRTHDAY dành riêng cho Rita ID; producer bên ngoài gửi BIRTHDAY sẽ được backend chuyển thành SYSTEM. Thiếu/null/chuỗi không hỗ trợ → SYSTEM tại Rita ID. So khớp chính xác; không trim/uppercase.',
  ),
  priority: enumInput.describe(
    'Nhận diện LOW, MEDIUM, HIGH, URGENT. Thiếu/null/chuỗi không hỗ trợ → MEDIUM tại Rita ID. So khớp chính xác; không trim/uppercase.',
  ),
});
export type NotificationExampleRequest = z.infer<typeof requestSchema>;

const transportCodes = new Set([
  'DISABLED',
  'UNAVAILABLE',
  'BLOCKED',
  'BACKPRESSURE',
  'IN_FLIGHT_LIMIT',
  'STOPPING',
  'UNROUTABLE',
  'NACKED',
  'DELIVERY_UNCERTAIN',
]);
export const templates = {
  'task-assigned': 'Người quản lý đã tạo và giao task demo cho bạn',
  'task-commented': 'Nguyễn Văn A đã bình luận trong task của bạn',
};

/** Publisher injection keeps app creation free of external connections. */
export function createNotificationExampleRouter(
  publisher?: NotificationPublisher,
) {
  const router = Router();
  for (const [route, summary] of Object.entries(templates)) {
    router.post('/' + route, async (req, res) => {
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'INVALID_NOTIFICATION_REQUEST',
            message: 'Invalid notification example request.',
          },
        });
        return;
      }
      const message: MessageEnvelope = {
        messageId: randomUUID(),
        type: NOTIFICATION_TYPE,
        schemaVersion: 2,
        source: 'task-manage-app-example',
        occurredAt: new Date().toISOString(),
        data: {
          ...parsed.data,
          scenario: 'task.' + route,
          summary: parsed.data.summary ?? summary,
        },
      };
      try {
        if (!publisher) throw new RabbitMqError('UNAVAILABLE');
        await publisher.publish({
          exchange: NOTIFICATION_EXCHANGE,
          routingKey: NOTIFICATION_TYPE,
          message,
        });
        res.status(202).json({
          messageId: message.messageId,
          status: 'broker-confirmed',
          simulation: true,
        });
      } catch (error) {
        const code =
          error instanceof RabbitMqError && transportCodes.has(error.code)
            ? error.code
            : 'PUBLISH_FAILED';
        const uncertain = code === 'DELIVERY_UNCERTAIN';
        res.status(uncertain ? 504 : 503).json({
          messageId: message.messageId,
          error: {
            code,
            message: uncertain
              ? 'Delivery is uncertain; the message may have been sent.'
              : 'Notification transport is unavailable or rejected the message.',
          },
        });
      }
    });
  }
  return router;
}
