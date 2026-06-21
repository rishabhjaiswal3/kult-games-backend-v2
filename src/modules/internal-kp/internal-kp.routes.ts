import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../../config';
import { AppError } from '../../core/error';
import { ok } from '../../core/response';
import { InternalKpService } from './internal-kp.service';

export function internalKpRouter(service: InternalKpService): Router {
  const router = Router();

  router.use(requireInternalKpKey);

  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const walletAddress = req.query['walletAddress'] ?? req.query['wallet'];
      const data = await service.getKp(String(walletAddress ?? ''));
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.adjustKp(req.body);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function requireInternalKpKey(req: Request, _res: Response, next: NextFunction): void {
  const expected = config.internal.kpApiKey?.trim();
  if (!expected) {
    return next(AppError.internal('Internal KP API key is not configured'));
  }

  const provided = req.header(config.internal.kpHeaderName)?.trim();
  if (!provided || !safeEquals(provided, expected)) {
    return next(AppError.unauthorized('Invalid internal KP key'));
  }

  next();
}

function safeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
