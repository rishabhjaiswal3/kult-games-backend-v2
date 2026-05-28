import { AppError } from '../../core/error';
import { ValkyQueue } from '../../db/redis';
import { logger } from '../../db/logger';
import { SocialPostRepository } from './social-media.repository';
import { SubmitPostRequest, ScrapeJob } from './social-media.model';
import { config } from '../../config';

const SUPPORTED_PLATFORMS = ['twitter', 'instagram', 'tiktok', 'facebook', 'reddit', 'linkedin', 'pinterest'];
const PLATFORM_LABELS: Record<string, string> = {
  twitter: 'Twitter',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  facebook: 'Facebook',
  reddit: 'Reddit',
  linkedin: 'LinkedIn',
  pinterest: 'Pinterest',
};

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

function toClientValidationStatus(status?: string): 'Pending' | 'Valid' | 'Invalid' {
  switch ((status ?? '').toLowerCase()) {
    case 'validated':
    case 'valid':
      return 'Valid';
    case 'rejected':
    case 'failed':
    case 'invalid':
      return 'Invalid';
    case 'pending':
    default:
      return 'Pending';
  }
}

function validationReason(status?: string): string | undefined {
  switch ((status ?? '').toLowerCase()) {
    case 'rejected':
      return 'The public post was scraped, but the required Kult Moment reference was not found.';
    case 'failed':
      return 'The public post could not be validated by the scraper. Please retry after a short delay.';
    default:
      return undefined;
  }
}

function numberFromRaw(raw: unknown, keys: string[]): number {
  if (!raw || typeof raw !== 'object') return 0;
  const obj = raw as Record<string, unknown>;

  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number(value.replace(/,/g, ''));
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return 0;
}

type SocialPostRecord = Awaited<ReturnType<SocialPostRepository['findByWallet']>>[number];

function toClientPost(post: SocialPostRecord) {
  const validationStatus = toClientValidationStatus(post.validation_status);
  const numLikes = numberFromRaw(post.raw_data, [
    'num_likes',
    'likes',
    'like_count',
    'likes_count',
    'reactions',
    'reaction_count',
    'upvotes',
    'score',
  ]);

  return {
    id: post._id?.toString() ?? post.post_id,
    momentId: post.moment_id ?? '',
    platform: PLATFORM_LABELS[post.platform] ?? post.platform,
    externalPostId: post.post_id,
    url: post.post_url,
    numLikes,
    score: validationStatus === 'Valid' ? Math.max(1, numLikes) : 0,
    isValidated: validationStatus === 'Valid',
    validationStatus,
    validationReason: validationReason(post.validation_status),
    lastValidatedAt: post.scraped_at?.toISOString(),
    createdAt: post.created_at?.toISOString() ?? new Date(0).toISOString(),
    updatedAt: post.scraped_at?.toISOString() ?? post.created_at?.toISOString() ?? new Date(0).toISOString(),
  };
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

    const postUrl = (req.postUrl ?? req.url)?.trim();
    if (!postUrl) throw AppError.badRequest('postUrl is required');

    const postId = req.postId?.trim() || extractPostId(postUrl);
    const momentId = req.momentId?.trim();

    const exists = await this.repo.existsByPlatformAndPostId(platform, postId);
    if (exists) throw AppError.conflict('Post already submitted');

    await this.repo.create({
      wallet_address: wallet,
      moment_id: momentId,
      platform,
      post_id: postId,
      post_url: postUrl,
      validation_status: 'pending',
    });

    if (this.scrapeQueue) {
      const job: ScrapeJob = { platform, postUrl, walletAddress: wallet, postId, momentId, attempt: 0 };
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

  async getMySharedPosts(wallet: string) {
    const posts = await this.repo.findByWallet(wallet, 0, 100);
    return { posts: posts.map(toClientPost) };
  }

  async requeuePost(wallet: string, postId: string) {
    const post = await this.repo.findByWalletAndPostId(wallet, postId);
    if (!post) throw AppError.notFound('Post not found');

    await this.repo.markPending(wallet, postId);

    if (this.scrapeQueue) {
      const job: ScrapeJob = {
        platform: post.platform,
        postUrl: post.post_url,
        walletAddress: wallet,
        postId: post.post_id,
        momentId: post.moment_id,
        attempt: 0,
      };
      await this.scrapeQueue.push(job).catch((err) => {
        logger.error({ err }, 'Failed to requeue scrape job');
      });
    }

    return { message: 'Post validation requeued', postId };
  }
}
