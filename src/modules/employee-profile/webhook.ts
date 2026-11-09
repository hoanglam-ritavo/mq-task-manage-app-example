import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, RequestHandler } from 'express';
import { Router, raw } from 'express';
import type { Logger } from 'pino';
import { z } from 'zod';
import { employeeProfilesData } from './schema.js';
import { utcTimestamp, uuid } from '../../shared/contracts.js';
import { AppError } from '../../shared/errors/app-error.js';
export const profileEnvelope = z.strictObject({
  messageId: uuid,
  type: z.literal('outbound.sync.profile'),
  schemaVersion: z.literal(1),
  source: z.literal('rita-id'),
  occurredAt: utcTimestamp,
  revision: z
    .string()
    .regex(/^[1-9]\d{0,18}$/)
    .refine((v) => BigInt(v) <= 9223372036854775807n),
  data: employeeProfilesData,
});
export type ProfileEvent = z.infer<typeof profileEnvelope>;
type Employee = ProfileEvent['data']['employees'][number];
const canonical = (v: unknown): string =>
  JSON.stringify(
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, value]) => [k, JSON.parse(canonical(value)) as unknown]),
        )
      : Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)) as unknown)
        : v,
  );
const digest = (s: string | Buffer) =>
  createHash('sha256').update(s).digest('hex');
export class ProfileStore {
  private receipts = new Map<string, string>();
  private profiles = new Map<
    string,
    { revision: bigint; hash: string; employee: Employee }
  >();
  constructor(
    private readonly maxProfiles = 1000,
    private readonly maxReceipts = 10000,
  ) {}
  apply(event: ProfileEvent, body: Buffer): 'applied' | 'duplicate' | 'stale' {
    const id = event.messageId.toLowerCase(),
      hash = digest(body),
      seen = this.receipts.get(id);
    if (seen) {
      if (seen !== hash)
        throw new AppError(
          409,
          'EVENT_IDENTITY_CONFLICT',
          'Event identity has different content.',
        );
      return 'duplicate';
    }
    const employee = event.data.employees[0]!,
      key = employee._id.toLowerCase(),
      prior = this.profiles.get(key),
      revision = BigInt(event.revision),
      employeeHash = digest(canonical(employee));
    let status: 'applied' | 'duplicate' | 'stale' = 'applied';
    if (prior && revision < prior.revision) status = 'stale';
    else if (prior && revision === prior.revision) {
      if (employeeHash !== prior.hash)
        throw new AppError(
          409,
          'REVISION_CONFLICT',
          'Revision has different profile content.',
        );
      status = 'duplicate';
    }
    if (
      this.receipts.size >= this.maxReceipts ||
      (!prior && this.profiles.size >= this.maxProfiles)
    )
      throw new AppError(
        503,
        'DEMO_CAPACITY_REACHED',
        'Demo memory capacity reached.',
      );
    // No await between comparison and application: one process only, no partial mutation.
    if (status === 'applied')
      this.profiles.set(key, {
        revision,
        hash: employeeHash,
        employee: structuredClone(employee),
      });
    this.receipts.set(id, hash);
    return status;
  }
  snapshot(userId: string) {
    const p = this.profiles.get(userId.toLowerCase());
    return p ? structuredClone(p) : undefined;
  }
}
function header(req: Request, name: string) {
  if (
    req.rawHeaders.filter(
      (_, i) => i % 2 === 0 && req.rawHeaders[i]?.toLowerCase() === name,
    ).length !== 1
  )
    return undefined;
  return req.get(name);
}
export const webhookAuthentication =
  (secret: string | undefined): RequestHandler =>
  (req, _res, next) => {
    if (!secret)
      return next(
        new AppError(
          503,
          'WEBHOOK_NOT_CONFIGURED',
          'Webhook is not configured.',
        ),
      );
    const id = header(req, 'webhook-id'),
      ts = header(req, 'webhook-timestamp'),
      signature = header(req, 'webhook-signature');
    if (
      !id ||
      !uuid.safeParse(id).success ||
      !ts ||
      !/^\d{1,12}$/.test(ts) ||
      Math.abs(Date.now() / 1000 - Number(ts)) > 300 ||
      !signature ||
      !/^v1,[A-Za-z0-9+/]{43}=$/.test(signature)
    )
      return next(
        new AppError(
          401,
          'WEBHOOK_UNAUTHORIZED',
          'Invalid webhook credentials.',
        ),
      );
    // Raw bytes are captured by the scoped parser; no JSON parsing or state work yet.
    if (!Buffer.isBuffer(req.body))
      return next(
        new AppError(
          401,
          'WEBHOOK_UNAUTHORIZED',
          'Invalid webhook credentials.',
        ),
      );
    const expected = createHmac(
      'sha256',
      Buffer.from(secret.slice(6), 'base64'),
    )
      .update(id + '.' + ts + '.')
      .update(req.body)
      .digest();
    const supplied = Buffer.from(signature.slice(3), 'base64');
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(expected, supplied)
    )
      return next(
        new AppError(
          401,
          'WEBHOOK_UNAUTHORIZED',
          'Invalid webhook credentials.',
        ),
      );
    next();
  };
export function createProfileWebhookRouter(
  secret: string | undefined,
  logger: Logger,
  store = new ProfileStore(),
) {
  const router = Router();
  router.post(
    '/',
    raw({ type: () => true, limit: 256 * 1024, inflate: false }),
    webhookAuthentication(secret),
    (req, res) => {
      const started = performance.now();
      let event: ProfileEvent;
      try {
        event = profileEnvelope.parse(
          JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(
              req.body as Buffer,
            ),
          ) as unknown,
        );
      } catch {
        throw new AppError(
          400,
          'INVALID_PROFILE_EVENT',
          'Invalid profile event.',
        );
      }
      if (event.messageId !== req.get('webhook-id'))
        throw new AppError(
          400,
          'EVENT_ID_MISMATCH',
          'Webhook identity does not match.',
        );
      const status = store.apply(event, req.body as Buffer);
      logger.info(
        {
          messageId: event.messageId,
          revision: event.revision,
          outcome: status,
          durationMs: Math.round(performance.now() - started),
        },
        'Profile webhook processed in RAM',
      );
      res.status(200).json({ messageId: event.messageId, status });
    },
  );
  return router;
}
