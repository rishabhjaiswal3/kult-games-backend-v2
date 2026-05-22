import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { ok } from '../../core/response';
import { MomentsService } from './moments.service';

export function momentsRouter(service: MomentsService): Router {
  const router = Router();

  // POST /api/moments/register
  router.post('/register', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.createMoment(req.player!.walletAddress, req.body);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/moments — public feed
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const perPage = Math.min(50, parseInt(req.query['per_page'] as string) || 20);
      const tags = (req.query['tags'] as string)?.split(',').map((t) => t.trim()).filter(Boolean);
      const search = req.query['search-query'] as string | undefined ?? req.query['searchQuery'] as string | undefined;
      const data = await service.getFeed(page, perPage, tags, search);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/moments/my
  router.get('/my', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const perPage = Math.min(50, parseInt(req.query['per_page'] as string) || 20);
      const data = await service.getPlayerMoments(req.player!.walletAddress, page, perPage);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/moments/:momentId
  router.get('/:momentId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.getMoment(req.params['momentId']!);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/moments/:momentId/zg-proof
  router.get('/:momentId/zg-proof', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.getZgProof(req.params['momentId']!);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/moments/:momentId/da-events
  router.get('/:momentId/da-events', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.getDaEvents(req.params['momentId']!);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/moments/:momentId
  router.patch('/:momentId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.updateMoment(req.player!.walletAddress, req.params['momentId']!, req.body);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/moments/:momentId
  router.delete('/:momentId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.deleteMoment(req.player!.walletAddress, req.params['momentId']!);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/moments/:momentId/like
  router.post('/:momentId/like', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.likeMoment(req.player!.walletAddress, req.params['momentId']!);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/moments/:momentId/zg/retry
  router.post('/:momentId/zg/retry', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.retryZgMigration(req.player!.walletAddress, req.params['momentId']!);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
