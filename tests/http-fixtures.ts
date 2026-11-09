import { randomUUID, createHmac } from 'node:crypto';
import { parseEnv } from '../src/config/env.js';
export const token = 'fictional_demo_token_12345678901234567890';
export const secret = 'whsec_' + Buffer.alloc(32, 7).toString('base64');
export const config = parseEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DEMO_API_TOKEN: token,
  RITA_API_BASE_URL: 'https://rita.example.test/api/',
  RITA_INTEGRATION_API_KEY:
    'rik_11111111-1111-4111-8111-111111111111.' + 'a'.repeat(64),
  RITA_WEBHOOK_SIGNING_SECRET: secret,
});
export const userId = '22222222-2222-4222-8222-222222222222';
export function profileEvent(revision = '9007199254740993') {
  return {
    messageId: randomUUID(),
    type: 'outbound.sync.profile' as const,
    schemaVersion: 1 as const,
    source: 'rita-id' as const,
    occurredAt: '2026-11-07T00:00:00Z',
    revision,
    data: {
      syncRunId: randomUUID(),
      employees: [
        {
          _id: userId,
          name: 'Fictional employee',
          email: 'fictional@example.test',
          employee_id: null,
          phone_number: null,
          active: true,
          is_developer: false,
          groups: 'EMPLOYEE' as const,
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
              others: [] as string[],
            },
          },
        },
      ],
    },
  };
}
export function input() {
  return {
    messageId: randomUUID(),
    occurredAt: '2026-11-07T00:00:00Z',
    data: {
      actor: null,
      recipientUserIds: [userId],
      title: 'Fictional title',
      custom_badge: null,
    },
  };
}
export function signature(
  body: string,
  id: string,
  ts = String(Math.floor(Date.now() / 1000)),
) {
  return {
    'webhook-id': id,
    'webhook-timestamp': ts,
    'webhook-signature':
      'v1,' +
      createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
        .update(id + '.' + ts + '.' + body)
        .digest('base64'),
  };
}
export const webhookPath = '/api/v1/webhooks/rita-id/employee-profile';
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
