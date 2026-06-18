import { Router, Request, Response, NextFunction } from 'express';
import { ok } from '../../core/response';
import { AccessCodeService } from './access-code.service';

export function accessCodeRouter(service: AccessCodeService): Router {
  const router = Router();

  router.post('/verify', (req: Request, res: Response, next: NextFunction) => {
    try {
      ok(res, service.verify(req.body));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
