import { Router, Request, Response, NextFunction } from 'express';
import { nanoid } from 'nanoid';
import { requireAuth } from '../../middleware/auth';
import { ok } from '../../core/response';
import { AppError } from '../../core/error';
import { generatePresignedUploadUrl, publicUrlForKey } from '../../external/spaces';
import { config } from '../../config';

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/gif':  'gif',
  'image/webp': 'webp',
  'video/mp4':  'mp4',
  'video/webm': 'webm',
};

function safePathSegment(value: string): string {
  const segment = value.trim().replace(/[^a-zA-Z0-9]/g, '');
  return segment || 'unknown-wallet';
}

export function uploadRouter(): Router {
  const router = Router();

  // POST /api/upload/presign
  router.post('/presign', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { filename, contentType } = req.body as { filename?: string; contentType?: string };

      if (!filename?.trim()) throw AppError.badRequest('filename is required');

      const ct = (contentType ?? '').trim().toLowerCase();
      const ext = ALLOWED_CONTENT_TYPES[ct];
      if (!ext) throw AppError.badRequest(`Unsupported content_type '${contentType}'`);

      const uploadPath = config.spaces.uploadPath.replace(/^\/|\/$/g, '');
      const walletSegment = safePathSegment(req.player!.walletAddress);
      const key = `${uploadPath}/${walletSegment}/${nanoid()}.${ext}`;

      const { uploadUrl, publicUrl } = await generatePresignedUploadUrl(key);

      ok(res, {
        upload_url: uploadUrl,
        public_url: publicUrl,
        required_headers: { 'x-amz-acl': 'public-read' },
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
