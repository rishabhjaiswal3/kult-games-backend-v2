import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth';
import { ok } from '../../core/response';
import { GameLeaderboardConfigRepository } from '../leaderboard/leaderboard.repository';
import { ListingRepository } from '../marketplace/marketplace.repository';

export function adminRouter(
  lbConfigRepo: GameLeaderboardConfigRepository,
  listingRepo: ListingRepository,
): Router {
  const router = Router();

  router.use(requireAuth, requireAdmin);

  // PUT /api/admin/leaderboard-config — upsert a game leaderboard config
  router.put('/leaderboard-config', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const cfg = req.body;
      if (!cfg.identification) {
        return res.status(400).json({ ok: false, message: 'identification is required' });
      }
      await lbConfigRepo.upsert(cfg);
      ok(res, { message: 'Leaderboard config upserted' });
    } catch (err) {
      next(err);
    }
  });

  // PUT /api/admin/marketplace/listings — upsert a marketplace listing
  router.put('/marketplace/listings', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const listing = req.body;
      if (!listing.gameIdentification || !listing.name) {
        return res.status(400).json({ ok: false, message: 'gameIdentification and name are required' });
      }
      await listingRepo.upsert(listing);
      ok(res, { message: 'Listing upserted' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
