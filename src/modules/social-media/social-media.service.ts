import { AppError } from '../../core/error';
import { ValkyQueue } from '../../db/redis';
import { logger } from '../../db/logger';
import { SocialPostRepository } from './social-media.repository';
import { SubmitPostRequest, ScrapeJob } from './social-media.model';
import { config } from '../../config';

const SUPPORTED_PLATFORMS = ['twitter', 'instagram', 'tiktok', 'facebook', 'reddit', 'linkedin', 'pinterest'];

function extractPostId(url: string): string {
  // Extract a stable identifier from the URL path
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? url;
  } catch {
    return url;
  }
}

export class SocialMediaService {
  constructor(
    private readonly repo: SocialPostRepository,
    private readonly scrapeQueue: ValkyQueue | null,
  ) {}

  async submitPost(wallet: string, req: SubmitPostRequest) {
    const platform = req.platform.toLowerCase().trim();
    if (!SUPPORTED_PLATFORMS.includes(platform)) {
      throw AppError.badRequest(`Unsupported platform: ${req.platform}`);
    }

    const postUrl = req.postUrl?.trim();
    if (!postUrl) throw AppError.badRequest('postUrl is required');

    const postId = extractPostId(postUrl);

    const exists = await this.repo.existsByPlatformAndPostId(platform, postId);
    if (exists) throw AppError.conflict('Post already submitted');

    await this.repo.create({
      wallet_address: wallet,
      platform,
      post_id: postId,
      post_url: postUrl,
      validation_status: 'pending',
    });

    if (this.scrapeQueue) {
      const job: ScrapeJob = { platform, postUrl, walletAddress: wallet, postId };
      await this.scrapeQueue.push(job).catch((err) => {
        logger.error({ err }, 'Failed to queue scrape job');
      });
    }

    return { message: 'Post submitted for validation', postId };
  }

  async getMyPosts(wallet: string, page: number, perPage: number) {
    const skip = (page - 1) * perPage;
    const posts = await this.repo.findByWallet(wallet, skip, perPage);
    return { posts };
  }
}
