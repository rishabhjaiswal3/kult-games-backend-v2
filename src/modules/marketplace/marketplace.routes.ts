import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { ok } from '../../core/response';
import { MarketplaceService } from './marketplace.service';

export function marketplaceRouter(service: MarketplaceService): Router {
  const router = Router();

  // GET /api/marketplace?gameIdentification=&category=&page=1&per_page=20
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = Math.max(1, parseInt(req.query['page'] as string) || 1);
      const pageSize = Math.min(100, parseInt(req.query['per_page'] as string) || 20);
      const data = await service.getListings(
        req.query['gameIdentification'] as string | undefined,
        req.query['category'] as string | undefined,
        page,
        pageSize,
      );
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/marketplace/orders/prepare (auth)
  router.post('/orders/prepare', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.prepareOrder(
        req.player!.walletAddress,
        req.player!.walletAddress,
        req.body,
      );
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/marketplace/orders/complete (auth)
  router.post('/orders/complete', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderId, txHash } = req.body as { orderId: string; txHash: string };
      await service.completeOrder(req.player!.walletAddress, orderId, txHash);
      ok(res, { message: 'Order completed' });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/marketplace/orders/mine (auth)
  router.get('/orders/mine', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.getMyOrders(req.player!.walletAddress);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/marketplace/:id — keep after /orders/* so "orders" is not treated as a listing ID.
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.getListing(req.params['id']!);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
