import { Router, Request, Response } from 'express';
import { MomentsRepository } from '../moments/moments.repository';
import { config } from '../../config';
import type { MomentModel } from '../moments/moments.model';
import {
  buildMomentPageUrl,
  isVideoMoment,
  pickImageDimensions,
  resolveOgImageMetaUrl,
  resolveOgImageMimeType,
} from './share.helpers';
import { createDefaultOgImageHandler, createMomentShareImageHandler } from './share.ogImage';

const CRAWLER_UA_PATTERN =
  /twitterbot|facebookexternalhit|facebot|discordbot|slackbot|telegrambot|whatsapp|linkedinbot|googlebot|bingbot|applebot|pinterest|redditbot|vkshare|outbrain|flipboard|tumblr|w3c_validator|bot\/|spider\/|crawler\//i;

function isCrawler(userAgent: string): boolean {
  return CRAWLER_UA_PATTERN.test(userAgent);
}

function resolveVideoMimeType(moment: MomentModel): string {
  const fileType = String(moment.assetMetadata?.['fileType'] ?? '').toLowerCase();
  if (fileType.startsWith('video/')) return fileType;
  return 'video/mp4';
}

function resolveZgAssetUrl(moment: MomentModel): string | undefined {
  const zgUrl = moment.assetZgHash ? config.zg.gatewayUrlFor(moment.assetZgHash) : null;
  return zgUrl ?? undefined;
}

function resolveVideoAssetUrl(moment: MomentModel): string | undefined {
  if (moment.assetUrl?.trim()) return moment.assetUrl.trim();
  return resolveZgAssetUrl(moment);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '...';
}

function buildShareHtml(req: Request, moment: MomentModel, momentId: string): string {
  const spaUrl = buildMomentPageUrl(req, momentId);
  const canonicalUrl = spaUrl;
  const title = escapeHtml(truncate(moment.title?.trim() || 'Kult Moment', 70));
  const description = escapeHtml(truncate(
    moment.description?.trim() || moment.aiCaption?.trim() || 'A gaming moment shared on Kult, verified on the 0G Network.',
    155,
  ));
  const videoAssetUrl = resolveVideoAssetUrl(moment);
  const ogImageRaw = resolveOgImageMetaUrl(req, momentId, moment);
  const isVideo = isVideoMoment(moment);
  const videoMime = resolveVideoMimeType(moment);
  const siteName = escapeHtml(config.share.siteName);
  const safeVideoAsset = videoAssetUrl ? escapeHtml(videoAssetUrl) : '';
  const safeSpaUrl = escapeHtml(spaUrl);
  const safeCanonicalUrl = escapeHtml(canonicalUrl);
  const defaultImg = config.share.defaultOgImage ? escapeHtml(config.share.defaultOgImage) : '';
  const ogImage = ogImageRaw ? escapeHtml(ogImageRaw) : defaultImg;
  const ogImageMime = resolveOgImageMimeType(ogImageRaw);
  const imageDims = pickImageDimensions(moment);

  const videoTags = isVideo && safeVideoAsset ? `
  <!-- Video meta (Facebook, Discord, LinkedIn support og:video for inline playback) -->
  <meta property="og:type" content="video.other" />
  <meta property="og:video" content="${safeVideoAsset}" />
  <meta property="og:video:secure_url" content="${safeVideoAsset}" />
  <meta property="og:video:type" content="${escapeHtml(videoMime)}" />
  <meta property="og:video:width" content="${imageDims.width}" />
  <meta property="og:video:height" content="${imageDims.height}" />` : '';

  const imageTags = ogImage ? `
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:image:url" content="${ogImage}" />
  <meta property="og:image:secure_url" content="${ogImage}" />${ogImageMime ? `
  <meta property="og:image:type" content="${escapeHtml(ogImageMime)}" />` : ''}
  <meta property="og:image:width" content="${imageDims.width}" />
  <meta property="og:image:height" content="${imageDims.height}" />
  <meta property="og:image:alt" content="${title}" />` : '';

  const twitterTags = `
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />${ogImage ? `
  <meta name="twitter:image" content="${ogImage}" />
  <meta name="twitter:image:alt" content="${title}" />` : ''}`;

  const tags = moment.tags ?? [];
  const keywords = [...tags, ...(moment.relatedGames ?? [])].filter(Boolean).join(', ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} - ${siteName}</title>
  <meta name="description" content="${description}" />${keywords ? `
  <meta name="keywords" content="${escapeHtml(keywords)}" />` : ''}

  <!-- Open Graph core -->
  <meta property="og:site_name" content="${siteName}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${safeCanonicalUrl}" />
  <link rel="canonical" href="${safeCanonicalUrl}" />
  <meta property="og:locale" content="en_US" />${isVideo ? videoTags : `
  <meta property="og:type" content="article" />`}${imageTags}${twitterTags}

  <!-- Redirect humans to the SPA immediately; crawlers skip script execution -->
  <script>window.location.replace("${safeSpaUrl}");</script>
  <noscript><meta http-equiv="refresh" content="0; url=${safeSpaUrl}" /></noscript>
</head>
<body>
  <p>Opening <a href="${safeSpaUrl}">${title}</a> on ${siteName}...</p>
</body>
</html>`;
}

/**
 * Express handler for GET /moments/:momentId
 * Serves OG-tag HTML for crawlers; humans get a JS redirect to the SPA.
 * Register this BEFORE the legacy-prefix rewriter so the URL isn't rewritten
 * to /api/moments/:momentId (which returns JSON, not HTML).
 *
 * DigitalOcean routing note:
 *   By default DO routes /api/* to this service and everything else to the
 *   static frontend. To make the SPA page URL work for social sharing you
 *   must add a route rule in the DO app spec:
 *     { match: { path: { prefix: "/moments" } }, component: { name: "<backend-service-name>" } }
 *   Place it ABOVE the static-site catch-all rule.
 */
export function createMomentSpaOgHandler(repo: MomentsRepository) {
  return async (req: Request, res: Response, next: () => void) => {
    // API clients (axios from React app) send Accept: application/json — pass those through
    // so the legacy-prefix rewriter can forward them to the moments JSON API.
    // Browsers and social crawlers send Accept: text/html — serve OG HTML for those.
    const accept = req.headers['accept'] ?? '';
    if (accept && !accept.includes('text/html')) return next();

    const momentId = (req.params as { momentId?: string }).momentId?.trim();
    if (!momentId) return next();

    const spaUrl = buildMomentPageUrl(req, momentId);
    try {
      const moment = await repo.findByMomentId(momentId);
      if (!moment) return res.redirect(302, spaUrl);

      const html = buildShareHtml(req, moment, momentId);
      const ua = req.headers['user-agent'] ?? '';
      return res
        .status(200)
        .set('Content-Type', 'text/html; charset=utf-8')
        .set('Cache-Control', isCrawler(ua) ? 'public, max-age=60, stale-while-revalidate=300' : 'no-store')
        .send(html);
    } catch {
      return res.redirect(302, spaUrl);
    }
  };
}

export function shareRouter(repo: MomentsRepository): Router {
  const router = Router();
  const momentShareImageHandler = createMomentShareImageHandler(repo);
  const defaultOgImageHandler = createDefaultOgImageHandler();

  router.get('/default-og.jpg', defaultOgImageHandler);
  router.get('/default-og', defaultOgImageHandler);

  router.get('/moments/:momentId/og-image.jpg', momentShareImageHandler);
  router.get('/moments/:momentId/og-image', momentShareImageHandler);
  router.get('/moments/:momentId/share-image.jpg', momentShareImageHandler);

  router.get('/moments/:momentId', async (req: Request, res: Response) => {
    const { momentId } = req.params as { momentId: string };
    const spaUrl = buildMomentPageUrl(req, momentId);

    try {
      const moment = await repo.findByMomentId(momentId);

      if (!moment) {
        return res.redirect(302, spaUrl);
      }

      const html = buildShareHtml(req, moment, momentId);
      const ua = req.headers['user-agent'] ?? '';

      if (isCrawler(ua)) {
        return res
          .status(200)
          .set('Content-Type', 'text/html; charset=utf-8')
          .set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
          .send(html);
      }

      return res
        .status(200)
        .set('Content-Type', 'text/html; charset=utf-8')
        .set('Cache-Control', 'no-store')
        .send(html);
    } catch {
      return res.redirect(302, spaUrl);
    }
  });

  return router;
}
