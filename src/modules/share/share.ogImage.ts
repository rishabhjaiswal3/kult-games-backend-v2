import { Request, Response } from 'express';
import axios from 'axios';
import sharp from 'sharp';
import { MomentsRepository } from '../moments/moments.repository';
import { resolveSourceImageUrl } from './share.helpers';

const DEFAULT_OG_IMAGE_SOURCE =
  'https://storage.googleapis.com/gpt-engineer-file-uploads/H3f4fSlZ9KaFAfzny5yMOG3UxmI2/social-images/social-1772817435284-Kult-Emblem-Variation.webp';

const MAX_OG_LONG_EDGE = 1200;

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

      const sourceUrl = resolveSourceImageUrl(moment);
      if (!sourceUrl) {
        return res.status(404).send('No image for moment');
      }

      const jpeg = await toShareJpeg(await fetchImageBuffer(sourceUrl));
      return sendJpeg(res, jpeg);
    } catch {
      return res.status(502).send('Could not render share image');
    }
  };
}
