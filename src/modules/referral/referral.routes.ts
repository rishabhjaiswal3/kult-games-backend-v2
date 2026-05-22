import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { ok } from '../../core/response';
import { ReferralService } from './referral.service';

export function referralRouter(service: ReferralService): Router {
  const router = Router();

  // GET /api/referral/me — get or create referral link for logged-in player
  router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = await service.getOrCreateCode(req.player!.walletAddress);
      const link = `https://klt.gm/r/${code}`;
      ok(res, { code, link });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function referralRedirectRouter(service: ReferralService): Router {
  const router = Router();

  // GET /r/:code — track referral click and redirect
  router.get('/:code', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? '0.0.0.0';
      await service.trackClick(req.params['code']!, ip).catch(() => {});
      res.redirect(302, 'https://app.kultgames.io');
    } catch (err) {
      next(err);
    }
  });

  return router;
}
