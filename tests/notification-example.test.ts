import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { RabbitMqError } from '../src/helper/rabbitmq/index.js';
import type { NotificationPublisher } from '../src/modules/notification-example/index.js';

const config = parseEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });
const recipients = [randomUUID()];
const base = {
  actor: randomUUID(),
  project_id: randomUUID(),
  recipientUserIds: recipients,
  title: 'Demo title',
  custom_badge: null,
};
const cases = [
  ['task-assigned', 'Người quản lý đã tạo và giao task demo cho bạn'],
  ['task-commented', 'Nguyễn Văn A đã bình luận trong task của bạn'],
];
const path = '/api/v1/examples/notifications/';
function fixture() {
  const publish = vi.fn<NotificationPublisher['publish']>().mockResolvedValue();
  return { publish, app: createApp(config, undefined, { publish }) };
}
describe('Notification example HTTP APIs', () => {
  it('accepts explicit system actor and no badge', async () => {
    const f = fixture();
    await request(f.app)
      .post(path + cases[0]![0])
      .send({ ...base, actor: null })
      .expect(202);
    expect(f.publish.mock.calls[0]![0].message.data).toMatchObject({
      actor: null,
      custom_badge: null,
    });
  });
  it.each(cases)(
    'publishes %s with fixed identity and defaults',
    async (route, summary) => {
      const f = fixture();
      const response = await request(f.app)
        .post(path + route)
        .send(base)
        .expect(202);
      expect(f.publish).toHaveBeenCalledTimes(1);
      const sent = f.publish.mock.calls[0]![0];
      expect(sent).toEqual({
        exchange: 'rita.notification.events',
        routingKey: 'notification.requested',
        message: {
          messageId: response.body.messageId,
          type: 'notification.requested',
          schemaVersion: 2,
          source: 'task-manage-app-example',
          occurredAt: expect.any(String),
          data: {
            scenario: 'task.' + route,
            ...base,
            summary,
            custom_badge: null,
          },
        },
      });
      expect(response.body).toEqual({
        messageId: expect.any(String),
        status: 'broker-confirmed',
        simulation: true,
      });
      expect(sent.message.messageId).toMatch(/^[0-9a-f-]{36}$/);
      expect(new Date(sent.message.occurredAt).toISOString()).toBe(
        sent.message.occurredAt,
      );
    },
  );
  it('preserves overrides and unsupported enum strings for consumer normalization', async () => {
    const f = fixture();
    const body = {
      ...base,
      title: ' Demo ',
      summary: 'Custom',
      custom_badge: { label: 'Badge', status: '' },
      type: 'unknown',
      priority: null,
    };
    await request(f.app)
      .post(path + cases[0]![0])
      .send(body)
      .expect(202);
    expect(f.publish.mock.calls[0]![0].message.data).toMatchObject(body);
  });
  it.each([
    { title: undefined },
    { actor: undefined },
    { actor: 'bad' },
    { project_id: undefined },
    { project_id: 'bad' },
    { custom_badge: undefined },
    { custom_badge: { label: 'Badge' } },
    { custom_badge: { status: null } },
    { custom_badge: { label: ' ', status: null } },
    { custom_badge: { label: 'Badge', status: null, extra: true } },
    { custom_badge: { label: 'Badge', status: 3 } },
    { recipientUserIds: [] },
    { recipientUserIds: ['bad'] },
    { recipientUserIds: [recipients[0], recipients[0]!.toUpperCase()] },
    { recipientUserIds: Array.from({ length: 101 }, () => randomUUID()) },
    { recipientUserIds: recipients, source: 'forged' },
    { recipientUserIds: recipients, title: ' ' },
    { recipientUserIds: recipients, title: 'x'.repeat(201) },
    { recipientUserIds: recipients, summary: 'x'.repeat(2001) },
    { recipientUserIds: recipients, custom_badge: 'x'.repeat(101) },
    { recipientUserIds: recipients, priority: 4 },
    { recipientUserIds: recipients, type: {} },
    { recipientUserIds: recipients, custom_badge_status: [] },
    { recipientUserIds: recipients, priority: 'x'.repeat(101) },
  ])('rejects invalid body without publishing', async (body) => {
    const f = fixture();
    const response = await request(f.app)
      .post(path + cases[0]![0])
      .send({ ...base, ...body })
      .expect(400);
    expect(response.body.error.code).toBe('INVALID_NOTIFICATION_REQUEST');
    expect(f.publish).not.toHaveBeenCalled();
  });
  it('waits for confirm before reporting success', async () => {
    const f = fixture();
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let confirm!: () => void;
    const waiting = new Promise<void>((resolve) => {
      confirm = resolve;
    });
    f.publish.mockImplementation(() => {
      entered();
      return waiting;
    });
    let completed = false;
    const response = request(f.app)
      .post(path + cases[0]![0])
      .send(base)
      .then((r) => {
        completed = true;
        return r;
      });
    await started;
    expect(completed).toBe(false);
    confirm();
    expect((await response).status).toBe(202);
  });
  it.each([
    'DISABLED',
    'UNAVAILABLE',
    'BLOCKED',
    'BACKPRESSURE',
    'IN_FLIGHT_LIMIT',
    'STOPPING',
    'UNROUTABLE',
    'NACKED',
    'DELIVERY_UNCERTAIN',
  ])('reports %s once without resend', async (code) => {
    const f = fixture();
    f.publish.mockRejectedValue(new RabbitMqError(code));
    const response = await request(f.app)
      .post(path + cases[0]![0])
      .send(base)
      .expect(code === 'DELIVERY_UNCERTAIN' ? 504 : 503);
    expect(response.body.error.code).toBe(code);
    expect(response.body.messageId).toBe(
      f.publish.mock.calls[0]![0].message.messageId,
    );
    expect(f.publish).toHaveBeenCalledTimes(1);
  });
  it('sanitizes arbitrary failures and handles missing publisher without connection creation', async () => {
    const f = fixture();
    f.publish.mockRejectedValue(new Error('private payload or password'));
    const failed = await request(f.app)
      .post(path + cases[0]![0])
      .send(base)
      .expect(503);
    expect(failed.body.error.code).toBe('PUBLISH_FAILED');
    expect(JSON.stringify(failed.body)).not.toContain('private');
    const absent = await request(createApp(config))
      .post(path + cases[0]![0])
      .send(base)
      .expect(503);
    expect(absent.body.error.code).toBe('UNAVAILABLE');
  });
});
