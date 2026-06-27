import type { Request } from 'express';
import { config } from '../../config';
import type { MomentModel } from '../moments/moments.model';

const VIDEO_URL_EXT = /\.(mp4|webm|mov|m4v|ogv)(?:\?.*)?$/i;

export function isVideoMoment(moment: MomentModel): boolean {
  const fileType = String(moment.assetMetadata?.['fileType'] ?? '').toLowerCase();
  if (fileType.startsWith('video/') || moment.assetMetadata?.['mediaType'] === 'video') return true;
  // Fallback: check the asset URL extension when fileType metadata is absent
  const urlToCheck = (moment.assetUrl ?? '').split('?')[0].toLowerCase();
  return VIDEO_URL_EXT.test(urlToCheck);
}

export function resolveSourceImageUrl(moment: MomentModel): string | undefined {
  const meta = moment.assetMetadata ?? {};

  // 1. Explicit OG image override in metadata (highest priority)
  const ogImageUrl = meta['ogImageUrl'];
  if (typeof ogImageUrl === 'string' && ogImageUrl.trim()) {
    return ogImageUrl.trim();
  }

  if (isVideoMoment(moment)) {
    // 2. Explicit thumbnail from metadata
    for (const key of ['thumbnailUrl', 'thumbnail', 'posterUrl', 'poster', 'coverImage', 'previewUrl']) {
      const val = meta[key];
      if (typeof val === 'string' && val.trim()) return val.trim();
    }
    // 3. Fall back to default Kult logo for video-only moments
    return config.share.defaultOgImage || undefined;
  }

  // Image moment — use the actual asset URL (proxy converts any format to JPEG)
  if (moment.assetUrl?.trim()) return moment.assetUrl.trim();

  // ZG-stored asset (hash → gateway URL)
  const zgUrl = moment.assetZgHash ? config.zg.gatewayUrlFor(moment.assetZgHash) : null;
  return zgUrl ?? undefined;
}

/** True when the moment has any image we can render for social previews. */
export function momentHasShareImage(moment: MomentModel): boolean {
  return Boolean(resolveSourceImageUrl(moment));
}

function resolveImageMimeType(imageUrl: string | undefined): string | undefined {
  if (!imageUrl) return undefined;
  const path = imageUrl.split('?')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.avif')) return 'image/avif';
  return undefined;
}


export function requestOrigin(req: Request): string {
  const proto = (req.get('x-forwarded-proto') ?? req.protocol).split(',')[0]?.trim() || 'https';
  const host = (req.get('x-forwarded-host') ?? req.get('host') ?? '').split(',')[0]?.trim();
  return host ? `${proto}://${host}` : '';
}

export function buildPublicAppOrigin(req: Request): string {
  const configured = config.share.publicAppUrl.replace(/\/+$/, '');
  const legacyMomentsApp = 'https://kult-browser-moments-p5wgi.ondigitalocean.app';
  if (configured && configured !== legacyMomentsApp) return configured;
  return requestOrigin(req) || configured;
}

export function buildMomentPageUrl(req: Request, momentId: string): string {
  return `${buildPublicAppOrigin(req)}/moments/${momentId}`;
}

export function buildOgImageProxyUrl(req: Request, momentId: string): string {
  const origin = buildPublicAppOrigin(req);
  return `${origin}/api/moments/${momentId}/share-image.jpg`;
}

/**
 * URL placed in og:image / twitter:image.
 *
 * Always routed through the JPEG proxy endpoint rather than returning the raw
 * storage URL directly. This guarantees:
 *   • Content-Type is always image/jpeg (social platforms reject WebP/octet-stream)
 *   • Works for WebP, AVIF, and files uploaded without explicit Content-Type
 *   • 24-hour CDN cache on the proxy means overhead is negligible per moment
 */
export function resolveOgImageMetaUrl(req: Request, momentId: string, moment: MomentModel): string | undefined {
  if (!momentHasShareImage(moment)) return undefined;
  return buildOgImageProxyUrl(req, momentId);
}

export function resolveOgImageMimeType(metaUrl: string | undefined): string | undefined {
  if (!metaUrl) return undefined;
  if (metaUrl.includes('/share-image.jpg') || metaUrl.includes('/og-image.jpg')) return 'image/jpeg';
  return resolveImageMimeType(metaUrl);
}

export function pickImageDimensions(moment: MomentModel): { width: number; height: number } {
  const meta = moment.assetMetadata ?? {};
  const width = Number(meta['width']);
  const height = Number(meta['height']);
  if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  return { width: 1200, height: 630 };
}
