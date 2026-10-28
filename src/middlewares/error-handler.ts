import type { ErrorRequestHandler } from 'express';
import type { Logger } from 'pino';
import { AppError } from '../shared/errors/app-error.js';

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    if (error instanceof AppError) {
      res
        .status(error.status)
        .json({ error: { code: error.code, message: error.message } });
      return;
    }
    const parserType =
      typeof error === 'object' && error !== null && 'type' in error
        ? error.type
        : undefined;
    if (parserType === 'entity.parse.failed') {
      res.status(400).json({
        error: { code: 'INVALID_JSON', message: 'Invalid JSON body.' },
      });
      return;
    }
    if (parserType === 'entity.too.large') {
      res.status(413).json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body is too large.',
        },
      });
      return;
    }
    // Do not serialize arbitrary errors: they may contain request bodies or credentials.
    logger.error({ code: 'INTERNAL_SERVER_ERROR' }, 'Unhandled request error');
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error.',
      },
    });
  };
}
