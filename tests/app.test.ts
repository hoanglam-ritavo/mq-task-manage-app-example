import express from 'express';
import request from 'supertest';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { parseEnv } from '../src/config/env.js';
import { createErrorHandler } from '../src/middlewares/error-handler.js';

const config = parseEnv({ NODE_ENV: 'test', LOG_LEVEL: 'silent' });

describe('HTTP application', () => {
  it('reports application health', async () => {
    const response = await request(createApp(config))
      .get('/health')
      .expect(200);
    expect(response.body).toEqual({
      status: 'ok',
      service: 'task-manage-app-example',
    });
  });
  it('returns a structured 404', async () => {
    const response = await request(createApp(config))
      .get('/api/v1/missing')
      .expect(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Route not found.' },
    });
  });
  it('rejects malformed JSON', async () => {
    const response = await request(createApp(config))
      .post('/api/v1/missing')
      .set('Content-Type', 'application/json')
      .send('{"secret":')
      .expect(400);
    expect(response.body).toEqual({
      error: { code: 'INVALID_JSON', message: 'Invalid JSON body.' },
    });
  });
  it('rejects oversized bodies', async () => {
    const response = await request(createApp(config))
      .post('/api/v1/missing')
      .send({ value: 'x'.repeat(1024 * 1024) })
      .expect(413);
    expect(response.body).toEqual({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large.',
      },
    });
  });
  it('handles rejected async routes without exposing errors', async () => {
    const app = express();
    app.get('/failure', async () => {
      throw new Error('private-value');
    });
    app.use(createErrorHandler(pino({ level: 'silent' })));
    const response = await request(app).get('/failure').expect(500);
    expect(response.body).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error.',
      },
    });
  });
  it('logs request metadata without query, body or credentials', async () => {
    let output = '';
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        output += String(chunk);
        callback();
      },
    });
    const logger = pino({ level: 'info' }, stream);
    await request(createApp(config, logger))
      .post('/missing?token=query-secret')
      .set('Authorization', 'Bearer auth-secret')
      .set('Cookie', 'session=cookie-secret')
      .send({ password: 'body-secret' })
      .expect(404);
    const record = JSON.parse(output.trim()) as Record<string, unknown>;
    expect(record).toMatchObject({
      method: 'POST',
      path: '/missing',
      status: 404,
    });
    expect(record.durationMs).toEqual(expect.any(Number));
    for (const secret of [
      'query-secret',
      'auth-secret',
      'cookie-secret',
      'body-secret',
    ]) {
      expect(output).not.toContain(secret);
    }
  });
});
