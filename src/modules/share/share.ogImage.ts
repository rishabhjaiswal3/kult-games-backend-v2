import { Request, Response } from 'express';
import axios from 'axios';
import sharp from 'sharp';
import { MomentsRepository } from '../moments/moments.repository';
import { resolveSourceImageUrls } from './share.helpers';
import type { MomentModel } from '../moments/moments.model';

const DEFAULT_OG_IMAGE_SOURCE =
  'https://storage.googleapis.com/gpt-engineer-file-uploads/H3f4fSlZ9KaFAfzny5yMOG3UxmI2/social-images/social-1772817435284-Kult-Emblem-Variation.webp';

const MAX_OG_LONG_EDGE = 1200;

const GAME_COLORS: Record<string, string> = {
  'ai-arena':   '#00d4ff',
  'aiarena':    '#00d4ff',
  'robowars':   '#ff6b35',
  'robo':       '#ff6b35',
  'warzone':    '#ff3366',
  'royale':     '#ff3366',
  'zerodash':   '#00ff88',
  'zero-dash':  '#00ff88',
  'highway':    '#ffaa00',
};

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapText(text: string, maxCharsPerLine: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > maxCharsPerLine) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = (current + ' ' + word).trim();
    }
    if (lines.length >= 3) break;
  }
  if (current && lines.length < 3) lines.push(current);
  return lines;
}

function resolveAccentColor(moment: MomentModel): string {
  const games = (moment.relatedGames ?? []).join(' ').toLowerCase();
  for (const [slug, color] of Object.entries(GAME_COLORS)) {
    if (games.includes(slug)) return color;
  }
  return '#9a35ff';
}

async function generateMomentCard(moment: MomentModel): Promise<Buffer> {
  const accent = resolveAccentColor(moment);
  const title = (moment.title?.trim() || 'Kult Moment').slice(0, 120);
  const game = (moment.relatedGames?.[0] ?? 'Kult Games').toUpperCase();
  const lines = wrapText(title, 32);

  const lineHeight = 68;
  const startY = 280 - ((lines.length - 1) * lineHeight) / 2;

  const textElements = lines.map((line, i) =>
    `<text x="80" y="${startY + i * lineHeight}" fill="white" font-family="Arial, Helvetica, sans-serif" font-size="58" font-weight="bold">${escapeXml(line)}</text>`
  ).join('\n      ');

  const svg = `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#060811;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#150820;stop-opacity:1" />
    </linearGradient>
    <linearGradient id="glow" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" style="stop-color:${accent};stop-opacity:0.18" />
      <stop offset="100%" style="stop-color:${accent};stop-opacity:0" />
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect x="0" y="0" width="480" height="630" fill="url(#glow)" />
  <rect width="1200" height="5" fill="${accent}" />
  <text x="80" y="148" fill="${accent}" font-family="Arial, Helvetica, sans-serif" font-size="22" font-weight="bold" letter-spacing="10">${escapeXml(game)}</text>
  ${textElements}
  <text x="80" y="580" fill="${accent}66" font-family="Arial, Helvetica, sans-serif" font-size="18" letter-spacing="8">KULT MOMENTS</text>
  <rect x="0" y="619" width="1200" height="11" fill="${accent}22" />
</svg>`;

  return sharp(Buffer.from(svg))
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

async function fetchImageBuffer(url: string): Promise<Buffer> {
  const upstream = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 15_000,
    maxContentLength: 12 * 1024 * 1024,
    validateStatus: (status) => status >= 200 && status < 300,
  });
  return Buffer.from(upstream.data);
}

/** Convert any raster format sharp supports (JPEG, PNG, WebP, AVIF, GIF, TIFF, HEIC…) to OG JPEG. */
async function toShareJpeg(source: Buffer): Promise<Buffer> {
  return sharp(source, { animated: false, failOn: 'none' })
    .rotate()
    .resize(MAX_OG_LONG_EDGE, MAX_OG_LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 86, mozjpeg: true })
    .toBuffer();
}

function sendJpeg(res: Response, jpeg: Buffer) {
  return res
    .status(200)
    .set('Content-Type', 'image/jpeg')
    .set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800')
    .send(jpeg);
}

export function createDefaultOgImageHandler() {
  return async (_req: Request, res: Response) => {
    try {
      const jpeg = await toShareJpeg(await fetchImageBuffer(DEFAULT_OG_IMAGE_SOURCE));
      return sendJpeg(res, jpeg);
    } catch {
      return res.status(502).send('Default OG image unavailable');
    }
  };
}

export function createMomentShareImageHandler(repo: MomentsRepository) {
  return async (req: Request, res: Response) => {
    const momentId = req.params['momentId']?.trim();
    if (!momentId) {
      return res.status(400).send('Missing moment id');
    }

    try {
      const moment = await repo.findByMomentId(momentId);
      if (!moment) {
        return res.status(404).send('Moment not found');
      }

      const sourceUrls = resolveSourceImageUrls(moment);

      // No candidates = video moment with no thumbnail → branded card immediately.
      if (sourceUrls.length === 0) {
        const card = await generateMomentCard(moment);
        return sendJpeg(res, card);
      }

      // Try each candidate URL in priority order (primary → 0G gateway → etc.).
      // For image moments this guarantees the actual screenshot is shown;
      // for video moments it tries every thumbnail source before giving up.
      for (const url of sourceUrls) {
        try {
          const jpeg = await toShareJpeg(await fetchImageBuffer(url));
          return sendJpeg(res, jpeg);
        } catch {
          // URL failed (inaccessible, video file, unsupported format) — try next.
        }
      }

      // All sources exhausted → branded card so crawlers always get a valid JPEG.
      const card = await generateMomentCard(moment);
      return sendJpeg(res, card);
    } catch {
      return res.status(502).send('Could not render share image');
    }
  };
}
