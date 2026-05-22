import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { ok } from '../../core/response';
import { GlobalLeaderboardService, GameLeaderboardService } from './leaderboard.service';

export function leaderboardRouter(
  globalService: GlobalLeaderboardService,
  gameService: GameLeaderboardService,
): Router {
  const router = Router();

  // GET /api/leaderboard/global?page=1&page_size=50
  router.get('/global', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const pageSize = Math.min(100, parseInt(req.query['page_size'] as string) || 50);
      const data = await globalService.getGlobalLeaderboardPaginated(page, pageSize);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/leaderboard/refresh (auth required)
  router.post('/refresh', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await globalService.refreshGlobalLeaderboard();
      ok(res, { refreshed: count, message: `Refreshed ${count} entries` });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/leaderboard/game/:identification?page=1&page_size=50
  router.get('/game/:identification', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const pageSize = Math.min(100, parseInt(req.query['page_size'] as string) || 50);
      const data = await gameService.fetchLeaderboardPaginated(
        req.params['identification']!,
        page,
        pageSize,
      );
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
