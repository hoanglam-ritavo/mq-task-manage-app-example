import { Router } from 'express';
import { z } from 'zod';
import { uuid, utcTimestamp } from '../../shared/contracts.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { NotificationClient } from '../../helper/rita-http/notification-client.js';
const nonblank = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0)
    .meta({ description: 'Chuỗi không trắng; không tự trim.', pattern: '\\S' });
const enumInput = z.string().max(100).nullable().optional();
export const notificationData = z
  .strictObject({
    group: z
      .strictObject({
        key: nonblank(200),
        type: z.enum(['COUPLE', 'MULTIPLE']),
        name: nonblank(200).nullable(),
      })
      .optional(),
    message: z
      .strictObject({
        id: nonblank(200),
        text: nonblank(2000),
        sentAt: z
          .string()
          .refine((value) => {
            if (
              !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
                value,
              ) ||
              !Number.isFinite(Date.parse(value))
            )
              return false;
            return (
              new Date(value).toISOString().replace(/\.000Z$/, 'Z') ===
              value
                .replace(
                  /\.(\d{1,2})Z$/,
                  (_, digits: string) => '.' + digits.padEnd(3, '0') + 'Z',
                )
                .replace(/\.000Z$/, 'Z')
            );
          })
          .meta({
            format: 'date-time',
            description:
              'Valid ISO UTC timestamp, precision up to milliseconds.',
          }),
      })
      .optional(),
    actor: z
      .uuid()
      .nullable()
      .describe(
        'UUID Rita ID user hoặc null cho hành động hệ thống; bắt buộc có mặt.',
      ),
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
  })
  .superRefine((data, ctx) => {
    if (
      data.type === 'MESSAGE'
        ? !data.group || !data.message
        : data.group !== undefined || data.message !== undefined
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'MESSAGE requires group and message; other types forbid them.',
      });
    }
  });

export const requestSchema = z.strictObject({
  messageId: uuid,
  occurredAt: utcTimestamp,
  correlationId: z
    .string()
    .refine((v) => !!v.trim())
    .optional(),
  data: notificationData,
});
export type NotificationExampleRequest = z.infer<typeof requestSchema>;
export const templates = {
  'task-assigned': 'Người quản lý đã tạo và giao task demo cho bạn',
  'task-commented': 'Nguyễn Văn A đã bình luận trong task của bạn',
};

export function createNotificationExampleRouter(client: NotificationClient) {
  const router = Router();
  for (const [route, summary] of Object.entries(templates))
    router.post('/' + route, async (req, res) => {
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success)
        throw new AppError(
          400,
          'INVALID_NOTIFICATION_REQUEST',
          'Invalid notification example request.',
        );
      const input = {
        ...parsed.data,
        messageId: parsed.data.messageId.toLowerCase(),
        data: {
          ...parsed.data.data,
          scenario: 'task.' + route,
          summary: parsed.data.data.summary ?? summary,
        },
      };
      try {
        await client.send(input);
        res.status(200).json({
          messageId: input.messageId,
          status: 'accepted',
          simulation: true,
        });
      } catch (error: unknown) {
        const e =
          error instanceof AppError
            ? error
            : new AppError(
                502,
                'RITA_OUTCOME_UNKNOWN',
                'Acceptance is unknown; retry the same identity and content.',
              );
        res.status(e.status).json({
          messageId: input.messageId,
          error: { code: e.code, message: e.message },
        });
      }
    });
  return router;
}
