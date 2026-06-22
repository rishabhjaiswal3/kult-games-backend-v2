import { Router, Request, Response, NextFunction } from 'express';
import { ok } from '../../core/response';
import { KultPointsService } from './kult-points.service';

export function kultPointsRouter(service: KultPointsService): Router {
  const router = Router();

  // GET /api/kp?walletAddress=0x...
  // GET /api/kult-points?walletAddress=0x...
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const walletAddress = req.query['walletAddress'] ?? req.query['wallet'];
      const data = await service.getKultPoints(String(walletAddress ?? ''));
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
