// Shared Express response helpers — keeps all handlers consistent.

import { Request, Response, NextFunction } from 'express';
import { AppError } from './error';
import { logger } from '../db/logger';

export function ok<T>(res: Response, data: T): void {
  res.json({ ok: true, data });
}

// ── Error handler middleware ───────────────────────────────────────────────────

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    if (err.statusCode === 500) {
      logger.error({ err }, 'Internal server error');
    }
    res.status(err.statusCode).json({ ok: false, message: err.message });
    return;
  }

  logger.error({ err }, 'Unhandled error');
  res.status(500).json({ ok: false, message: 'Internal server error' });
}
