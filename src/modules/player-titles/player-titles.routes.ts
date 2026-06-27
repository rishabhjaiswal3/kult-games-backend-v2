import { Router, Request, Response, NextFunction } from 'express';
import { ok } from '../../core/response';
import type { PlayerTitlesService } from './player-titles.service';

export function playerTitlesRouter(service: PlayerTitlesService): Router {
  const router = Router();

  // GET /api/player-titles/:walletAddress
  // Public — no JWT. Returns the titles (if any) for a given wallet address.
  router.get('/:walletAddress', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletAddress } = req.params;
      if (!walletAddress?.trim()) {
        res.status(400).json({ ok: false, error: 'walletAddress is required' });
        return;
      }
      const data = await service.getTitles(walletAddress.trim());
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
