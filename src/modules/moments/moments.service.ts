import { nanoid } from 'nanoid';
import { AppError } from '../../core/error';
import { logger } from '../../db/logger';
import { config } from '../../config';
import { ValkyQueue } from '../../db/redis';
import { fileExists } from '../../external/spaces';
import { MomentsRepository, MomentLikesRepository, DaEventRepository, MomentFeedOptions, MomentSortBy, MomentMode, MomentDate } from './moments.repository';
import { MomentModel, CreateMomentRequest, UpdateMomentRequest, MigrationJob } from './moments.model';
import type { OnchainActivityService } from '../onchain/onchain.service';

const MAX_TAGS = 10;
const MAX_RELATED_GAMES = 5;

function walletsMatch(stored: string, caller: string): boolean {
  return stored.trim().toLowerCase() === caller.trim().toLowerCase();
}

export class MomentsService {
  constructor(
    private readonly repo: MomentsRepository,
    private readonly likesRepo: MomentLikesRepository,
    private readonly daEventRepo: DaEventRepository | null,
    private readonly migrationQueue: ValkyQueue | null,
    private readonly onchainService: OnchainActivityService | null,
  ) {}

  async createMoment(wallet: string, req: CreateMomentRequest) {
    const title = req.title?.trim() ?? '';
    if (!title) throw AppError.badRequest('title is required');
    if (title.length > 200) throw AppError.badRequest('title cannot exceed 200 characters');
    if (req.description && req.description.length > 2000) {
      throw AppError.badRequest('description cannot exceed 2000 characters');
    }
    if ((req.tags?.length ?? 0) > MAX_TAGS) throw AppError.badRequest(`cannot have more than ${MAX_TAGS} tags`);

    const relatedGames = (req.relatedGames ?? []).slice(0, MAX_RELATED_GAMES);

    if (req.assetUrl?.trim()) {
      const exists = await fileExists(req.assetUrl.trim());
      if (!exists) throw AppError.badRequest('Verify failed: File not found in storage');
    }

    const momentId = nanoid(21);
    const assetUrl = req.assetUrl?.trim() || undefined;
    const rawAssetType = req.assetMetadata?.['fileType'];
    const assetType = typeof rawAssetType === 'string' ? rawAssetType : undefined;

    const moment: MomentModel = {
      momentId,
      playerWalletAddress: wallet.trim(),
      assetUrl,
      assetMetadata: req.assetMetadata,
      title,
      description: req.description?.trim() || undefined,
      tags: (req.tags ?? []).map((t) => t.trim()),
      relatedGames,
      socialMediaLinks: req.socialMediaLinks,
      zgStatus: assetUrl && assetType && config.zg.hasUpload() ? 'pending' : undefined,
      numLikes: 0,
      numComments: 0,
      aiHighlights: [],
    };

    await this.repo.create(moment);
    logger.info({ momentId, wallet }, 'Moment created');

    if (assetUrl && assetType && this.migrationQueue && config.zg.hasUpload()) {
      const job: MigrationJob = { assetUrl, momentId, assetType, attempt: 1 };
      await this.migrationQueue.push(job).catch((err) => {
        logger.error({ err, momentId }, 'Failed to queue migration job');
      });
    } else if (assetUrl && !assetType && config.zg.hasUpload()) {
      logger.warn({ momentId }, 'Moment created with assetUrl but missing fileType; skipping migration queue');
    }

    await this.daEventRepo?.record(momentId, 'MOMENT_CREATED').catch(() => {});

    return { momentId, message: 'Moment created successfully' };
  }

  async getFeed(page: number, perPage: number, options: MomentFeedOptions = {}) {
    const skip = (page - 1) * perPage;
    const { moments, totalCount } = await this.repo.getFeed(skip, perPage, options);
    return {
      moments: moments.map(toResponse),
      totalCount,
      page,
      perPage,
      totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / perPage),
    };
  }

  async getPlayerMoments(wallet: string, page: number, perPage: number) {
    const skip = (page - 1) * perPage;
    const { moments, totalCount } = await this.repo.getPlayerMoments(wallet, skip, perPage);
    return {
      moments: moments.map(toResponse),
      totalCount,
      page,
      perPage,
      totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / perPage),
    };
  }

  async getMoment(momentId: string) {
    const moment = await this.repo.findByMomentId(momentId);
    if (!moment) throw AppError.notFound('Moment not found');
    return toResponse(moment);
  }

  async updateMoment(wallet: string, momentId: string, req: UpdateMomentRequest) {
    const existing = await this.repo.findByMomentId(momentId);
    if (!existing) throw AppError.notFound('Moment not found');
    if (!walletsMatch(existing.playerWalletAddress, wallet)) {
      throw AppError.forbidden('You can only edit your own moments');
    }

    const patch: Partial<MomentModel> = {};
    if (req.title !== undefined) {
      const title = req.title.trim();
      if (!title) throw AppError.badRequest('title cannot be empty');
      patch.title = title;
    }
    if (req.description !== undefined) patch.description = req.description.trim() || undefined;
    if (req.tags !== undefined) {
      if (req.tags.length > MAX_TAGS) throw AppError.badRequest(`cannot have more than ${MAX_TAGS} tags`);
      patch.tags = req.tags.map((t) => t.trim()).filter(Boolean);
    }
    if (req.relatedGames !== undefined) patch.relatedGames = req.relatedGames.slice(0, MAX_RELATED_GAMES);
    if (req.socialMediaLinks !== undefined) patch.socialMediaLinks = req.socialMediaLinks;

    const updated = await this.repo.update(momentId, existing.playerWalletAddress, patch);
    if (!updated) throw AppError.notFound('Moment not found');
    return toResponse(updated);
  }

  async deleteMoment(wallet: string, momentId: string) {
    const existing = await this.repo.findByMomentId(momentId);
    if (!existing) throw AppError.notFound('Moment not found');
    if (!walletsMatch(existing.playerWalletAddress, wallet)) {
      throw AppError.forbidden('You can only delete your own moments');
    }

    const deleted = await this.repo.delete(momentId, existing.playerWalletAddress);
    if (!deleted) throw AppError.notFound('Moment not found');
    await this.daEventRepo?.record(momentId, 'MOMENT_DELETED').catch(() => {});
    return { message: 'Moment deleted' };
  }

  async likeMoment(wallet: string, momentId: string) {
    const moment = await this.repo.findByMomentId(momentId);
    if (!moment) throw AppError.notFound('Moment not found');

    const { alreadyLiked } = await this.likesRepo.like(momentId, wallet);
    if (!alreadyLiked) {
      await this.repo.incrementLikes(momentId, 1);
      await this.daEventRepo?.record(momentId, 'MOMENT_LIKED').catch(() => {});
    }

    return { liked: !alreadyLiked, message: alreadyLiked ? 'Already liked' : 'Liked' };
  }

  async getDaEvents(momentId: string) {
    if (!this.daEventRepo) return { events: [] };
    const events = await this.daEventRepo.findByMoment(momentId);
    return { events };
  }

  async getZgProof(momentId: string) {
    const moment = await this.repo.findByMomentId(momentId);
    if (!moment) throw AppError.notFound('Moment not found');

    return {
      assetZgHash: moment.assetZgHash,
      assetZgTxHash: moment.assetZgTxHash,
      metadataZgHash: moment.metadataZgHash,
      metadataZgTxHash: moment.metadataZgTxHash,
      zgStatus: moment.zgStatus,
      zgError: moment.zgError,
      zgUploadedAt: moment.zgUploadedAt,
      gatewayUrl: moment.assetZgHash ? config.zg.gatewayUrlFor(moment.assetZgHash) : null,
      explorerUrl: moment.assetZgTxHash ? config.zg.explorerUrlFor(moment.assetZgTxHash) : null,
    };
  }

  async retryZgMigration(wallet: string, momentId: string) {
    if (!config.zg.hasUpload()) throw AppError.badRequest('0G upload is not configured');

    const moment = await this.repo.findByMomentId(momentId);
    if (!moment) throw AppError.notFound('Moment not found');
    if (moment.playerWalletAddress !== wallet) throw AppError.forbidden('Not allowed');
    if (!moment.assetUrl) throw AppError.badRequest('Moment has no asset to migrate');

    const rawAssetType = moment.assetMetadata?.['fileType'];
    const assetType = typeof rawAssetType === 'string' ? rawAssetType : undefined;
    if (!assetType) throw AppError.badRequest('Missing asset fileType');

    const job: MigrationJob = {
      assetUrl: moment.assetUrl,
      momentId,
      assetType,
      attempt: 1,
    };

    await this.migrationQueue?.push(job).catch((err) => {
      logger.error({ err, momentId }, 'Failed to queue retry migration job');
      throw AppError.internal('Failed to queue retry migration job');
    });

    await this.repo.updateByMomentId(momentId, {
      zgStatus: 'pending',
      zgError: undefined,
    });

    return { message: 'Retry queued' };
  }
}

function toResponse(m: MomentModel) {
  return {
    momentId: m.momentId,
    playerWalletAddress: m.playerWalletAddress,
    assetUrl: m.assetUrl,
    assetMetadata: m.assetMetadata,
    title: m.title,
    description: m.description,
    tags: m.tags,
    relatedGames: m.relatedGames,
    socialMediaLinks: m.socialMediaLinks,
    numLikes: m.numLikes,
    numComments: m.numComments,
    aiCaption: m.aiCaption,
    aiRankScore: m.aiRankScore,
    aiHighlights: m.aiHighlights,
    aiStatus: m.aiStatus,
    aiMomentType: m.aiMomentType,
    aiSkillScore: m.aiSkillScore,
    aiReactionQuality: m.aiReactionQuality,
    aiRarity: m.aiRarity,
    assetZgHash: m.assetZgHash,
    assetZgTxHash: m.assetZgTxHash,
    metadataZgHash: m.metadataZgHash,
    metadataZgTxHash: m.metadataZgTxHash,
    zgStatus: m.zgStatus,
    zgError: m.zgError,
    zgUploadedAt: m.zgUploadedAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}
