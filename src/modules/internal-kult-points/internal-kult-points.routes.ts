import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../../config';
import { AppError } from '../../core/error';
import { ok } from '../../core/response';
import { InternalKultPointsService } from './internal-kult-points.service';

export function internalKultPointsRouter(service: InternalKultPointsService): Router {
  const router = Router();

  router.use(requireInternalKultPointsKey);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const walletAddress = req.query['walletAddress'] ?? req.query['wallet'];
      const data = await service.getKultPoints(String(walletAddress ?? ''));
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.adjustKultPoints(req.body);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function requireInternalKultPointsKey(req: Request, _res: Response, next: NextFunction): void {
  const expected = config.internal.kultPointsApiKey?.trim();
  if (!expected) {
    return next(AppError.internal('Internal Kult Points API key is not configured'));
  }

  const provided = req.header(config.internal.kultPointsHeaderName)?.trim();
  if (!provided || !safeEquals(provided, expected)) {
    return next(AppError.unauthorized('Invalid internal Kult Points key'));
  }

  next();
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
