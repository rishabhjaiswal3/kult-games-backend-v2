import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { ok } from '../../core/response';
import { MomentsService } from './moments.service';
import { CommentsService } from './comments.service';
import { MomentsRepository } from './moments.repository';
import { createDefaultOgImageHandler, createMomentShareImageHandler } from '../share/share.ogImage';

export function momentsRouter(service: MomentsService, comments: CommentsService, repo: MomentsRepository): Router {
  const router = Router();
  const shareImageHandler = createMomentShareImageHandler(repo);
  const defaultShareImageHandler = createDefaultOgImageHandler();

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
      const rawMediaType = req.query['media_type'] as string | undefined;
      const mediaType = rawMediaType === 'image' || rawMediaType === 'video' ? rawMediaType : undefined;
      const data = await service.getFeed(page, perPage, tags, search, mediaType);
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

  // ── Comment sub-routes — must come before /:momentId to avoid route shadowing ──

  // GET /api/moments/comments/:commentId/replies
  router.get('/comments/:commentId/replies', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page    = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const perPage = Math.min(50, parseInt(req.query['perPage'] as string) || 20);
      const data = await comments.listReplies(req.params['commentId']!, page, perPage);
      ok(res, data);
    } catch (err) { next(err); }
  });

  // POST /api/moments/comments/:commentId/replies
  router.post('/comments/:commentId/replies', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await comments.createReply(req.params['commentId']!, req.player!.walletAddress, req.body);
      res.status(201).json({ ok: true, data });
    } catch (err) { next(err); }
  });

  // PATCH /api/moments/comments/:commentId
  router.patch('/comments/:commentId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await comments.updateComment(req.params['commentId']!, req.player!.walletAddress, req.body);
      ok(res, data);
    } catch (err) { next(err); }
  });

  // DELETE /api/moments/comments/:commentId
  router.delete('/comments/:commentId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      await comments.deleteComment(req.params['commentId']!, req.player!.walletAddress);
      ok(res, { message: 'Comment deleted' });
    } catch (err) { next(err); }
  });

  // GET /api/moments/default/share-image.jpg — JPEG fallback for app-level OG tags
  router.get('/default/share-image.jpg', defaultShareImageHandler);

  // GET /api/moments/:momentId/share-image.jpg — social preview image (JPEG proxy)
  router.get('/:momentId/share-image.jpg', shareImageHandler);

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

  // POST /api/moments/:momentId/zg/retry
  router.post('/:momentId/zg/retry', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.retryZgMigration(req.player!.walletAddress, req.params['momentId']!);
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

  // GET /api/moments/:momentId/comments
  router.get('/:momentId/comments', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page    = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const perPage = Math.min(50, parseInt(req.query['perPage'] as string) || 20);
      const data = await comments.listComments(req.params['momentId']!, page, perPage);
      ok(res, data);
    } catch (err) { next(err); }
  });

  // POST /api/moments/:momentId/comments
  router.post('/:momentId/comments', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await comments.createComment(req.params['momentId']!, req.player!.walletAddress, req.body);
      res.status(201).json({ ok: true, data });
    } catch (err) { next(err); }
  });

  return router;
}
