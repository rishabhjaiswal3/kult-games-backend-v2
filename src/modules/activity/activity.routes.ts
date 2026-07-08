import { Router, Request, Response, NextFunction } from 'express';
import { ok } from '../../core/response';
import { requireAuth, requireAdmin, optionalAuth } from '../../middleware/auth';
import type { ActivityService } from './activity.service';
import type { ActivityEventInput } from './activity.model';

function clientIp(req: Request): string | undefined {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) {
    return forwarded.split(',')[0]?.trim();
  }
  return req.ip;
}

export function activityRouter(service: ActivityService): Router {
  const router = Router();

  /**
   * POST /api/activity/events
   * Batch ingest. Auth optional — anonymous sessions are tracked when logged out;
   * wallet is attached when JWT is present.
   */
  router.post('/events', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const events = (req.body?.events ?? req.body) as ActivityEventInput[];
      const data = await service.ingestBatch({
        events: Array.isArray(events) ? events : [],
        walletAddress: req.player?.walletAddress ?? null,
        userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
        ip: clientIp(req),
      });
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  /** Authenticated: own heatmap for a path. */
  router.get('/heatmap', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const path = typeof req.query.path === 'string' ? req.query.path : '/';
      const types =
        typeof req.query.types === 'string'
          ? req.query.types.split(',').map((t) => t.trim()).filter(Boolean)
          : undefined;
      const gridSize = req.query.gridSize ? Number(req.query.gridSize) : 40;
      const data = await service.heatmap({
        path,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        gridSize,
        walletAddress: req.player!.walletAddress,
        types,
      });
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  /** Authenticated: own activity summary. */
  router.get('/summary', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.summary({
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        walletAddress: req.player!.walletAddress,
        pathPrefix: typeof req.query.pathPrefix === 'string' ? req.query.pathPrefix : undefined,
      });
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  /** Authenticated: own recent events. */
  router.get('/recent', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.recent({
        limit: req.query.limit ? Number(req.query.limit) : 50,
        walletAddress: req.player!.walletAddress,
        path: typeof req.query.path === 'string' ? req.query.path : undefined,
        type: typeof req.query.type === 'string' ? req.query.type : undefined,
      });
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  /** Admin (dev): global heatmap across all wallets. */
  router.get('/admin/heatmap', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const path = typeof req.query.path === 'string' ? req.query.path : '/';
      const types =
        typeof req.query.types === 'string'
          ? req.query.types.split(',').map((t) => t.trim()).filter(Boolean)
          : undefined;
      const data = await service.heatmap({
        path,
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        gridSize: req.query.gridSize ? Number(req.query.gridSize) : 40,
        walletAddress: typeof req.query.wallet === 'string' ? req.query.wallet : null,
        types,
      });
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  /** Admin (dev): global summary. */
  router.get('/admin/summary', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.summary({
        from: typeof req.query.from === 'string' ? req.query.from : undefined,
        to: typeof req.query.to === 'string' ? req.query.to : undefined,
        walletAddress: typeof req.query.wallet === 'string' ? req.query.wallet : null,
        pathPrefix: typeof req.query.pathPrefix === 'string' ? req.query.pathPrefix : undefined,
      });
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
