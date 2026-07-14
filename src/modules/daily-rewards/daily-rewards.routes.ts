import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { ok } from '../../core/response';
import type { DailyRewardsService } from './daily-rewards.service';

export function dailyRewardsRouter(service: DailyRewardsService): Router {
  const router = Router();

  router.use(requireAuth);

  router.get('/daily', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.getState(req.player!.walletAddress);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  router.post('/daily/claim', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const legacyDay1 = req.body?.legacyDay1 === true;
      const data = await service.claim(req.player!.walletAddress, { legacyDay1 });
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
