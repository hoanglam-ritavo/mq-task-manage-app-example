import type { AppConfig } from '../../config/env.js';
import { AppError } from '../../shared/errors/app-error.js';
export interface NotificationRequest {
  messageId: string;
  occurredAt: string;
  correlationId?: string;
  data: Record<string, unknown>;
}
export interface NotificationClient {
  send(input: NotificationRequest): Promise<void>;
  stop(): Promise<void>;
}
export class NotificationClientError extends AppError {
  constructor(status: number, code: string, message: string) {
    super(status, code, message);
  }
}
const unknown = () =>
  new NotificationClientError(
    502,
    'RITA_OUTCOME_UNKNOWN',
    'Acceptance is unknown; retry the same identity and content.',
  );
export function notificationEndpoint(base: string): string {
  const url = new URL(base);
  url.pathname = url.pathname.replace(/\/+$/, '') + '/api-expose/notifications';
  return url.toString();
}
export function createNotificationClient(
  config: AppConfig,
  transport: typeof fetch = fetch,
  timeoutMs = 10000,
): NotificationClient {
  const operations = new Set<Promise<void>>();
  let stopping = false;
  async function dispatch(input: NotificationRequest, signal: AbortSignal) {
    const response = await transport(
      notificationEndpoint(config.rita.apiBaseUrl!),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': config.rita.apiKey!,
        },
        body: JSON.stringify(input),
        redirect: 'manual',
        signal,
      },
    );
    if (response.status !== 200) {
      await response.body?.cancel();
      const status = response.status;
      if (status === 401)
        throw new NotificationClientError(
          502,
          'RITA_CREDENTIAL_REJECTED',
          'Rita integration credentials are not eligible.',
        );
      if ([400, 409, 413, 503].includes(status))
        throw new NotificationClientError(
          status,
          'RITA_HTTP_' + status,
          status === 409
            ? 'Notification identity has different content.'
            : status === 503
              ? 'Rita storage is unavailable; retry the same identity and content.'
              : 'Rita rejected the notification.',
        );
      throw unknown();
    }
    const reader = response.body?.getReader();
    if (!reader) throw unknown();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16384) throw unknown();
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    let data: unknown;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw unknown();
    }
    if (
      !data ||
      typeof data !== 'object' ||
      !('messageId' in data) ||
      data.messageId !== input.messageId ||
      !('status' in data) ||
      data.status !== 'accepted'
    )
      throw unknown();
  }
  return {
    async send(input) {
      if (stopping)
        throw new NotificationClientError(
          503,
          'STOPPING',
          'Notification client is stopping.',
        );
      if (!config.rita.apiBaseUrl || !config.rita.apiKey)
        throw new NotificationClientError(
          503,
          'RITA_NOT_CONFIGURED',
          'Rita notification API is not configured.',
        );
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const work = dispatch(input, controller.signal).catch(
        (error: unknown) => {
          if (error instanceof NotificationClientError) throw error;
          throw unknown();
        },
      );
      operations.add(work);
      void work.finally(() => operations.delete(work)).catch(() => undefined);
      try {
        await Promise.race([
          work,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              controller.abort();
              reject(
                new NotificationClientError(
                  504,
                  'RITA_OUTCOME_UNKNOWN',
                  'Acceptance is unknown; retry the same identity and content.',
                ),
              );
            }, timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    async stop() {
      stopping = true;
      await Promise.allSettled([...operations]);
    },
  };
}
