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

function buildShareHtml(moment: MomentModel, spaUrl: string): string {
  const title        = escapeHtml(truncate(moment.title?.trim() || 'Kult Moment', 70));
  const description  = escapeHtml(truncate(moment.description?.trim() || 'A gaming moment shared on Kult — verified on the 0G Network.', 155));
  const assetUrl     = resolveAssetUrl(moment);
  const isVideo      = isVideoMoment(moment);
  const videoMime    = resolveVideoMimeType(moment);
  const siteName     = escapeHtml(config.share.siteName);
  const safeAsset    = assetUrl ? escapeHtml(assetUrl) : '';
  const safeSpaUrl   = escapeHtml(spaUrl);
  const defaultImg   = config.share.defaultOgImage ? escapeHtml(config.share.defaultOgImage) : '';

  // Always prefer the moment's own asset URL; only fall back to the default branding image
  // if the moment has no asset at all. For videos the asset IS the video file — Twitter and
  // Discord can't play it inline, but they will show the video's first frame as a thumbnail
  // when og:image points directly to the video URL. That beats showing a generic logo.
  const ogImage = safeAsset || defaultImg;

  const videoTags = isVideo && safeAsset ? `
  <!-- Video meta (Facebook, Discord, LinkedIn support og:video for inline playback) -->
  <meta property="og:type" content="video.other" />
  <meta property="og:video" content="${safeAsset}" />
  <meta property="og:video:secure_url" content="${safeAsset}" />
  <meta property="og:video:type" content="${escapeHtml(videoMime)}" />
  <meta property="og:video:width" content="1280" />
  <meta property="og:video:height" content="720" />` : '';

  const imageTags = ogImage ? `
  <!-- og:image — for images this is the asset; for videos platforms extract a thumbnail frame -->
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:image:secure_url" content="${ogImage}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${title}" />` : '';

  // Twitter: use "player" card is complex (requires Twitter approval + HTTPS embed).
  // Use "summary_large_image" for both types — shows the image/thumbnail prominently.
  const twitterCard    = 'summary_large_image';
  const twitterImage   = ogImage;

  const twitterTags = `
  <!-- Twitter Card -->
  <meta name="twitter:card" content="${twitterCard}" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />${twitterImage ? `
  <meta name="twitter:image" content="${twitterImage}" />
  <meta name="twitter:image:alt" content="${title}" />` : ''}`;

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
  <meta property="og:url" content="${safeSpaUrl}" />
  <meta property="og:locale" content="en_US" />${isVideo ? videoTags : `
  <meta property="og:type" content="article" />`}${imageTags}${twitterTags}

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

export function shareRouter(repo: MomentsRepository): Router {
  const router = Router();

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
      const html = buildShareHtml(moment, spaUrl);

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
