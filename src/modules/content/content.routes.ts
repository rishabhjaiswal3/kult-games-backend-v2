import { Router, Request, Response, NextFunction } from 'express';
import { ok } from '../../core/response';
import { ContentService } from './content.service';

export function contentRouter(service: ContentService): Router {
  const router = Router();

  // GET /api/content?page=home&section=top_picks&page_num=1&page_size=10
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, section } = req.query;
      if (!page || typeof page !== 'string') {
        return res.status(400).json({ ok: false, message: 'page query param is required' });
      }
      if (!section || typeof section !== 'string') {
        return res.status(400).json({ ok: false, message: 'section query param is required' });
      }
      const pageNum = parseInt(req.query['page_num'] as string) || 1;
      const pageSize = parseInt(req.query['page_size'] as string) || 10;
      const data = await service.getContent(page, section, pageNum, pageSize);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
