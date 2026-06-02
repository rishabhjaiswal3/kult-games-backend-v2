import { Router, Request, Response } from 'express';
import { MomentsRepository } from '../moments/moments.repository';
import { config } from '../../config';
import type { MomentModel } from '../moments/moments.model';

// User-agent patterns for social media crawlers that don't execute JavaScript.
const CRAWLER_UA_PATTERN =
  /twitterbot|facebookexternalhit|facebot|discordbot|slackbot|telegrambot|whatsapp|linkedinbot|googlebot|bingbot|applebot|pinterest|redditbot|vkshare|outbrain|flipboard|tumblr|w3c_validator|bot\/|spider\/|crawler\//i;

function isCrawler(userAgent: string): boolean {
  return CRAWLER_UA_PATTERN.test(userAgent);
}

function isVideoMoment(moment: MomentModel): boolean {
  const mediaType = String(moment.assetMetadata?.['mediaType'] ?? '').toLowerCase();
  if (mediaType === 'video') return true;

  const fileType = String(moment.assetMetadata?.['fileType'] ?? '').toLowerCase();
  return fileType.startsWith('video/');
}

function resolveVideoMimeType(moment: MomentModel): string {
  const fileType = String(moment.assetMetadata?.['fileType'] ?? '').toLowerCase();
  if (fileType.startsWith('video/')) return fileType;
  return 'video/mp4';
}

function resolveAssetUrl(moment: MomentModel): string | undefined {
  // Prefer 0G gateway URL if the asset has been stored there, fallback to origin URL.
  const zgUrl = moment.assetZgHash ? config.zg.gatewayUrlFor(moment.assetZgHash) : null;
  return zgUrl ?? moment.assetUrl;
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
  return text.slice(0, max - 1).trimEnd() + '…';
}

function resolveDimension(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : fallback;
}

function buildShareHtml(moment: MomentModel, spaUrl: string, shareUrl: string, playerUrl: string): string {
  const title        = escapeHtml(truncate(moment.title?.trim() || 'Kult Moment', 70));
  const description  = escapeHtml(truncate(moment.description?.trim() || 'A gaming moment shared on Kult — verified on the 0G Network.', 155));
  const assetUrl     = resolveAssetUrl(moment);
  const isVideo      = isVideoMoment(moment);
  const videoMime    = resolveVideoMimeType(moment);
  const videoWidth   = resolveDimension(moment.assetMetadata?.['width'], 1280);
  const videoHeight  = resolveDimension(moment.assetMetadata?.['height'], 720);
  const siteName     = escapeHtml(config.share.siteName);
  const safeAsset    = assetUrl ? escapeHtml(assetUrl) : '';
  const safeSpaUrl   = escapeHtml(spaUrl);
  const safeShareUrl = escapeHtml(shareUrl);
  const safePlayerUrl = escapeHtml(playerUrl);
  const defaultImg   = config.share.defaultOgImage ? escapeHtml(config.share.defaultOgImage) : '';

  // For images: og:image = asset URL.
  // For videos: og:image = thumbnailUrl (frame captured at upload) → real preview on all platforms.
  //             Falls back to branding image if no thumbnail was captured.
  //             og:video = actual video for platforms that support inline playback (Discord, FB).
  const videoThumbnailUrl = isVideo
    ? (moment.assetMetadata?.['thumbnailUrl'] as string | undefined)
    : undefined;
  const ogImage = isVideo
    ? (videoThumbnailUrl ? escapeHtml(videoThumbnailUrl) : defaultImg)
    : (safeAsset || defaultImg);

  const videoTags = isVideo && safeAsset ? `
  <!-- Video meta (Facebook, Discord, LinkedIn support og:video for inline playback) -->
  <meta property="og:type" content="video.other" />
  <meta property="og:video" content="${safeAsset}" />
  <meta property="og:video:secure_url" content="${safeAsset}" />
  <meta property="og:video:type" content="${escapeHtml(videoMime)}" />
  <meta property="og:video:width" content="${videoWidth}" />
  <meta property="og:video:height" content="${videoHeight}" />` : '';

  const imageTags = ogImage ? `
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:image:secure_url" content="${ogImage}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${title}" />` : '';

  // X/Twitter cannot receive uploaded media from the web intent. For video
  // moments, expose a Player Card so X can embed the video from the shared URL.
  const twitterCard  = isVideo && safeAsset ? 'player' : 'summary_large_image';
  const twitterImage = ogImage;

  const twitterTags = `
  <!-- Twitter Card -->
  <meta name="twitter:card" content="${twitterCard}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />${twitterImage ? `
  <meta name="twitter:image" content="${twitterImage}" />
  <meta name="twitter:image:alt" content="${title}" />` : ''}${isVideo && safeAsset ? `
  <meta name="twitter:player" content="${safePlayerUrl}" />
  <meta name="twitter:player:width" content="${videoWidth}" />
  <meta name="twitter:player:height" content="${videoHeight}" />
  <meta name="twitter:player:stream" content="${safeAsset}" />
  <meta name="twitter:player:stream:content_type" content="${escapeHtml(videoMime)}" />` : ''}`;

  // Hashtags from tags
  const tags     = moment.tags ?? [];
  const keywords = [...tags, ...(moment.relatedGames ?? [])].filter(Boolean).join(', ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — ${siteName}</title>
  <meta name="description" content="${description}" />${keywords ? `
  <meta name="keywords" content="${escapeHtml(keywords)}" />` : ''}

  <!-- Open Graph core -->
  <meta property="og:site_name" content="${siteName}" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${safeShareUrl}" />
  <meta property="og:locale" content="en_US" />${isVideo ? videoTags : `
  <meta property="og:type" content="article" />`}${imageTags}${twitterTags}
  <link rel="canonical" href="${safeShareUrl}" />

  <!-- Redirect humans to the SPA immediately; crawlers skip script execution -->
  <script>window.location.replace("${safeSpaUrl}");</script>
  <!-- Fallback for crawlers that honour meta-refresh but not JS (rare) -->
  <noscript><meta http-equiv="refresh" content="0; url=${safeSpaUrl}" /></noscript>
</head>
<body>
  <p>Opening <a href="${safeSpaUrl}">${title}</a> on ${siteName}…</p>
</body>
</html>`;
}

function buildPlayerHtml(moment: MomentModel, spaUrl: string): string {
  const title = escapeHtml(moment.title?.trim() || 'Kult Moment');
  const assetUrl = resolveAssetUrl(moment);
  const safeAsset = assetUrl ? escapeHtml(assetUrl) : '';
  const safeSpaUrl = escapeHtml(spaUrl);
  const videoMime = escapeHtml(resolveVideoMimeType(moment));
  const posterUrl = moment.assetMetadata?.['thumbnailUrl'];
  const safePoster = typeof posterUrl === 'string' && posterUrl.trim()
    ? escapeHtml(posterUrl.trim())
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #000; }
    body { overflow: hidden; }
    video { display: block; width: 100vw; height: 100vh; object-fit: contain; background: #000; }
    a { position: fixed; inset: 0; display: grid; place-items: center; color: #fff; font: 14px system-ui, sans-serif; text-decoration: none; background: #000; }
  </style>
</head>
<body>
  ${safeAsset ? `<video controls playsinline preload="metadata" ${safePoster ? `poster="${safePoster}"` : ''}>
    <source src="${safeAsset}" type="${videoMime}" />
  </video>` : `<a href="${safeSpaUrl}" target="_blank" rel="noopener noreferrer">Open this Kult Moment</a>`}
</body>
</html>`;
}

export function shareRouter(repo: MomentsRepository): Router {
  const router = Router();

  // GET /share/moments/:momentId/player
  // Iframe page used by X/Twitter Player Cards for video moments.
  router.get('/moments/:momentId/player', async (req: Request, res: Response) => {
    const { momentId } = req.params as { momentId: string };
    const spaUrl = `${config.share.publicAppUrl.replace(/\/+$/, '')}/moments/${momentId}`;

    try {
      const moment = await repo.findByMomentId(momentId);

      if (!moment || !isVideoMoment(moment)) {
        return res.redirect(302, spaUrl);
      }

      return res
        .status(200)
        .set('Content-Type', 'text/html; charset=utf-8')
        .set('Cache-Control', 'public, max-age=300, stale-while-revalidate=3600')
        .send(buildPlayerHtml(moment, spaUrl));
    } catch {
      return res.redirect(302, spaUrl);
    }
  });

  // GET /share/moments/:momentId
  // Serves a minimal HTML page with OG/Twitter Card meta tags.
  // Social media crawlers stop here and read the tags.
  // Browsers are redirected immediately to the SPA via inline script.
  router.get('/moments/:momentId', async (req: Request, res: Response) => {
    const { momentId } = req.params as { momentId: string };
    const spaUrl = `${config.share.publicAppUrl.replace(/\/+$/, '')}/moments/${momentId}`;

    try {
      const moment = await repo.findByMomentId(momentId);

      if (!moment) {
        // Unknown moment — redirect everyone to the SPA 404 page.
        return res.redirect(302, spaUrl);
      }

      const ua = req.headers['user-agent'] ?? '';
      const configuredShareBase = config.share.shareBaseUrl.replace(/\/+$/, '');
      const requestShareBase = `${req.protocol}://${req.get('host')}`.replace(/\/+$/, '');
      const shareBase = configuredShareBase || requestShareBase;
      const shareUrl = `${shareBase}/share/moments/${momentId}`;
      const playerUrl = `${shareUrl}/player`;
      const html = buildShareHtml(moment, spaUrl, shareUrl, playerUrl);

      if (isCrawler(ua)) {
        // Serve full HTML to crawler so it reads the meta tags.
        return res
          .status(200)
          .set('Content-Type', 'text/html; charset=utf-8')
          .set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
          .send(html);
      }

      // For regular browsers: still serve the HTML (they'll hit the inline JS redirect
      // instantly), but no need to cache — they'll be at the SPA URL in <1 frame.
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
