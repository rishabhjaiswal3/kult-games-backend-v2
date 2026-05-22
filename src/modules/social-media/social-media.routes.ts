import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { ok } from '../../core/response';
import { SocialMediaService } from './social-media.service';

export function socialMediaRouter(service: SocialMediaService): Router {
  const router = Router();

  // POST /api/social-media/posts
  router.post('/posts', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.submitPost(req.player!.walletAddress, req.body);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/social-media/posts/my
  router.get('/posts/my', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const perPage = Math.min(50, parseInt(req.query['per_page'] as string) || 20);
      const data = await service.getMyPosts(req.player!.walletAddress, page, perPage);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
