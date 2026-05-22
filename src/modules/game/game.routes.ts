import { Router, Request, Response, NextFunction } from 'express';
import { ok } from '../../core/response';
import { GameService } from './game.service';

export function gameRouter(service: GameService): Router {
  const router = Router();

  // GET /api/games?search=&page=1&page_size=20
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const search = req.query['search'] as string | undefined;
      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const pageSize = Math.min(100, parseInt(req.query['page_size'] as string) || 20);
      const data = await service.getAllGames(search, page, pageSize);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/games/categories
  router.get('/categories', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.getAllCategories();
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/games/:identification
  router.get('/:identification', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.getGameByIdentification(req.params['identification']!);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
