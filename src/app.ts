import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

import { config } from './config';
import { logger } from './db/logger';
import { errorHandler } from './core/response';
import { localization } from './middleware/localization';
import { ServiceFactory } from './factory/service.factory';

// Route builders
import { playerRouter } from './modules/player/player.routes';
import { gameRouter } from './modules/game/game.routes';
import { contentRouter } from './modules/content/content.routes';
import { leaderboardRouter } from './modules/leaderboard/leaderboard.routes';
import { marketplaceRouter } from './modules/marketplace/marketplace.routes';
import { momentsRouter } from './modules/moments/moments.routes';
import { socialMediaRouter } from './modules/social-media/social-media.routes';
import { referralRouter, referralRedirectRouter } from './modules/referral/referral.routes';
import { uploadRouter } from './modules/upload/upload.routes';
import { adminRouter } from './modules/admin/admin.routes';

export function createApp(services: ServiceFactory): express.Application {
  const app = express();

  // ── Global middleware ─────────────────────────────────────────────────────

  app.set('trust proxy', 1);

  app.use(cors({ origin: config.app.corsOrigins.includes('*') ? '*' : config.app.corsOrigins }));

  app.use(rateLimit({
    windowMs: 60_000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  app.use(express.json({ limit: '2mb' }));
  app.use(pinoHttp({ logger }));
  app.use(localization);

  // ── Routes ────────────────────────────────────────────────────────────────

  app.use('/api/player',       playerRouter(services.createPlayerService()));
  app.use('/api/games',        gameRouter(services.createGameService()));
  app.use('/api/content',      contentRouter(services.createContentService()));
  app.use('/api/leaderboard',  leaderboardRouter(services.createGlobalLeaderboardService(), services.createGameLeaderboardService()));
  app.use('/api/marketplace',  marketplaceRouter(services.createMarketplaceService()));
  app.use('/api/moments',      momentsRouter(services.createMomentsService()));
  app.use('/api/social-media', socialMediaRouter(services.createSocialMediaService()));
  app.use('/api/referral',     referralRouter(services.createReferralService()));
  app.use('/api/upload',       uploadRouter());
  app.use('/api/admin',        adminRouter(services.getLbConfigRepo(), services.getListingRepo()));

  // Referral redirect (short link: /r/:code)
  app.use('/r', referralRedirectRouter(services.createReferralService()));

  // Health check
  app.get('/health', (_req, res) => res.json({ ok: true, service: config.app.name }));

  // ── Error handler (must be last) ──────────────────────────────────────────

  app.use(errorHandler);

  return app;
}
