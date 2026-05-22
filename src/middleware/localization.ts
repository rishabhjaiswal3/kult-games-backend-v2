import { Request, Response, NextFunction } from 'express';

declare global {
  namespace Express {
    interface Request {
      locale?: string;
    }
  }
}

// Reads Accept-Language header and attaches a normalized locale to req.
export function localization(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers['accept-language'] ?? '';
  const primary = header.split(',')[0]?.split(';')[0]?.trim() ?? 'en';
  req.locale = primary || 'en';
  next();
}
