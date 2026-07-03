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
import { shareRouter, createMomentSpaOgHandler } from './modules/share/share.routes';
import { accessCodeRouter } from './modules/access/access-code.routes';
import { kultPointsRouter } from './modules/kult-points/kult-points.routes';
import { internalKultPointsRouter } from './modules/internal-kult-points/internal-kult-points.routes';
import { playerTitlesRouter } from './modules/player-titles/player-titles.routes';

export function createApp(services: ServiceFactory): express.Application {
  const app = express();
  const momentIdRoutePattern = '[A-Za-z0-9_-]{21}';

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

  // ── SPA-URL social-share handler — MUST be before the legacy-prefix rewriter ──
  // Serves OG-tag HTML for browser/crawler requests to /moments/:id so that
  // Twitter, Telegram, WhatsApp, Discord etc. embed the correct moment image.
  // API clients (axios) send Accept: application/json → handler passes them through
  // to the legacy rewriter → moments JSON API (no breakage).
  //
  // DO routing: the "/moments" route rule in DO should use preserve_path_prefix: true
  // (not "Path trimmed") so Express receives the full /moments/:momentId path.
  // With "Path trimmed" DO strips /moments and sends /:momentId — handled below.
  const momentOgHandler = createMomentSpaOgHandler(services.getMomentsRepo());
  // Full path — when DO uses preserve_path_prefix: true for the /moments route
  app.get(`/moments/:momentId(${momentIdRoutePattern})`, momentOgHandler);
  // Trimmed path — when DO uses "Path trimmed" (strips the /moments prefix)
  app.get(`/:momentId(${momentIdRoutePattern})`, momentOgHandler);

  // ── Backwards-compatibility: rewrite legacy root routes to /api/*
  // Some clients still request endpoints like `/marketplace` or `/games`.
  // Internally rewrite those to `/api/...` so we don't break existing traffic.
  const legacyPrefixes = ['/marketplace', '/games', '/content', '/leaderboard', '/moments', '/social-media', '/referral', '/upload', '/player', '/admin', '/access-code', '/kp', '/kult-points', '/player-titles'];
  app.use((req, _res, next) => {
    for (const p of legacyPrefixes) {
      if (req.path === p || req.path.startsWith(p + '/')) {
        req.url = '/api' + req.url;
        break;
      }
    }
    next();
  });

  // ── Routes ────────────────────────────────────────────────────────────────

  app.use('/api/player',       playerRouter(services.createPlayerService()));
  const publicKultPointsRouter = kultPointsRouter(services.createKultPointsService());
  app.use('/api/kp',           publicKultPointsRouter);
  app.use('/api/kult-points',  publicKultPointsRouter);
  // Legacy path — public read-only; no internal key required for GET.
  app.use('/api/internal/kp',  publicKultPointsRouter);
  app.use('/api/access-code',  accessCodeRouter(services.createAccessCodeService()));
  app.use('/api/internal/kult-points', internalKultPointsRouter(services.createInternalKultPointsService()));
  // Legacy alias — remove once callers migrate to /api/internal/kult-points
  app.use('/api/internal/kp', internalKultPointsRouter(services.createInternalKultPointsService()));
  // DigitalOcean app routing can strip `/api` before forwarding to Express.
  // Keep direct internal aliases so server-to-server KP calls still resolve.
  app.use('/internal/kult-points', internalKultPointsRouter(services.createInternalKultPointsService()));
  app.use('/internal/kp', internalKultPointsRouter(services.createInternalKultPointsService()));
  app.use('/api/games',        gameRouter(services.createGameService()));
  app.use('/api/content',      contentRouter(services.createContentService()));
  app.use('/api/leaderboard',  leaderboardRouter(services.createGlobalLeaderboardService(), services.createGameLeaderboardService()));
  app.use('/api/marketplace',  marketplaceRouter(services.createMarketplaceService()));
  const socialMediaRoutes = socialMediaRouter(services.createSocialMediaService());
  app.use('/api/moments/social-media', socialMediaRoutes);
  app.use('/api/moments',      momentsRouter(services.createMomentsService(), services.createCommentsService(), services.getMomentsRepo()));
  app.use('/api/social-media', socialMediaRoutes);
  app.use('/api/referral',     referralRouter(services.createReferralService()));
  app.use('/api/player-titles', playerTitlesRouter(services.createPlayerTitlesService()));
  app.use('/api/upload',       uploadRouter());
  app.use('/api/admin',        adminRouter(services.getLbConfigRepo(), services.getListingRepo()));

  // Share preview pages — bot-friendly HTML with OG/Twitter Card meta tags.
  // Browsers are redirected to the SPA via inline JS; crawlers read the meta tags.
  // Registered under both /share and /api/share:
  //   /share       → direct backend URL access (kult-browser-rust-l2lwg.ondigitalocean.app/share/...)
  //   /api/share   → via frontend domain where DigitalOcean forwards /api/* to this service
  const shareRouterInstance = shareRouter(services.getMomentsRepo());
  app.use('/share', shareRouterInstance);
  app.use('/api/share', shareRouterInstance);

  // Referral redirect (short link: /r/:code)
  app.use('/r', referralRedirectRouter(services.createReferralService()));

  // Health check
  app.get('/health', (_req, res) => res.json({ ok: true, service: config.app.name }));

  // ── Error handler (must be last) ──────────────────────────────────────────

  app.use(errorHandler);

  return app;
}
