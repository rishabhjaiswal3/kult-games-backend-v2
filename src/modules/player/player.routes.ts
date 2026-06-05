import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/auth';
import { ok } from '../../core/response';
import { PlayerService } from './player.service';

export function playerRouter(service: PlayerService): Router {
  const router = Router();

  // GET /api/player/nonce?walletAddress=...
  router.get('/nonce', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { walletAddress } = req.query;
      if (!walletAddress || typeof walletAddress !== 'string') {
        return res.status(400).json({ ok: false, message: 'walletAddress query param is required' });
      }
      const data = await service.getNonce(walletAddress);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/player/login
  router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? '0.0.0.0';
      const data = await service.login(req.body, ip);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  router.post('/telegram-miniapp-login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      ok(res, await service.telegramMiniAppLogin(req.body));
    } catch (err) {
      next(err);
    }
  });

  router.post('/privy-login', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ip = (req.headers['x-forwarded-for'] as string) ?? req.ip ?? '0.0.0.0';
      ok(res, await service.privyTonLogin(req.body, ip));
    } catch (err) {
      next(err);
    }
  });

  // GET /api/player/profile
  router.get('/profile', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = await service.getProfile(req.player!.walletAddress);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/player/name
  router.patch('/name', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = req.body;
      if (typeof name !== 'string') {
        return res.status(400).json({ ok: false, message: 'name is required' });
      }
      const data = await service.updateName(req.player!.walletAddress, name);
      ok(res, data);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
