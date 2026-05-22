import { nanoid } from 'nanoid';
import { AppError } from '../../core/error';
import { logger } from '../../db/logger';
import { ValkyQueue } from '../../db/redis';
import { config } from '../../config';
import { fileExists } from '../../external/spaces';
import { MomentsRepository, MomentLikesRepository, DaEventRepository } from './moments.repository';
import {
  MomentModel, CreateMomentRequest, UpdateMomentRequest, MigrationJob,
} from './moments.model';
import type { OnchainActivityService } from '../onchain/onchain.service';

const MAX_TAGS = 10;
const MAX_RELATED_GAMES = 5;

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
      zgStatus: assetUrl ? 'pending' : undefined,
      numLikes: 0,
      numComments: 0,
      aiHighlights: [],
    };

    await this.repo.create(moment);
    logger.info({ momentId, wallet }, 'Moment created');

    // Queue migration if we have an asset
    if (assetUrl && this.migrationQueue) {
      const assetType = req.assetMetadata?.['fileType'] as string | undefined;
      if (assetType) {
        const job: MigrationJob = { assetUrl, momentId, assetType, attempt: 1 };
        await this.migrationQueue.push(job).catch((err) => {
          logger.error({ err, momentId }, 'Failed to queue migration job');
        });
      }
    }

    await this.daEventRepo?.record(momentId, 'MOMENT_CREATED').catch(() => {});

    return { momentId, message: 'Moment created successfully' };
  }

  async getFeed(page: number, perPage: number, tags?: string[], search?: string) {
    const skip = (page - 1) * perPage;
    const { moments, totalCount } = await this.repo.getFeed(skip, perPage, tags, search);
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

  async getZgProof(momentId: string) {
    const moment = await this.repo.findByMomentId(momentId);
    if (!moment) throw AppError.notFound('Moment not found');

    return {
      momentId: moment.momentId,
      assetZgHash: moment.assetZgHash,
      assetZgTxHash: moment.assetZgTxHash,
      metadataZgHash: moment.metadataZgHash,
      metadataZgTxHash: moment.metadataZgTxHash,
      zgStatus: moment.zgStatus,
      zgUploadedAt: moment.zgUploadedAt,
      assetZgUrl: moment.assetZgHash ? config.zg.gatewayUrlFor(moment.assetZgHash) : null,
      metadataZgUrl: moment.metadataZgHash ? config.zg.gatewayUrlFor(moment.metadataZgHash) : null,
      assetZgTxUrl: moment.assetZgTxHash ? config.zg.explorerUrlFor(moment.assetZgTxHash) : null,
      metadataZgTxUrl: moment.metadataZgTxHash ? config.zg.explorerUrlFor(moment.metadataZgTxHash) : null,
    };
  }

  async updateMoment(wallet: string, momentId: string, req: UpdateMomentRequest) {
    const patch: Partial<MomentModel> = {};
    if (req.title !== undefined) {
      const title = req.title.trim();
      if (!title) throw AppError.badRequest('title cannot be empty');
      patch.title = title;
    }
    if (req.description !== undefined) patch.description = req.description.trim() || undefined;
    if (req.tags !== undefined) patch.tags = req.tags.map((t) => t.trim());
    if (req.relatedGames !== undefined) patch.relatedGames = req.relatedGames.slice(0, MAX_RELATED_GAMES);
    if (req.socialMediaLinks !== undefined) patch.socialMediaLinks = req.socialMediaLinks;

    const updated = await this.repo.update(momentId, wallet, patch);
    if (!updated) throw AppError.notFound('Moment not found');
    return toResponse(updated);
  }

  async deleteMoment(wallet: string, momentId: string) {
    const deleted = await this.repo.delete(momentId, wallet);
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

  async retryZgMigration(wallet: string, momentId: string) {
    const moment = await this.repo.findByMomentId(momentId);
    if (!moment) throw AppError.notFound('Moment not found');
    if (moment.playerWalletAddress.toLowerCase() !== wallet.toLowerCase()) {
      throw AppError.forbidden('Not the moment owner');
    }
    if (!moment.assetUrl) throw AppError.badRequest('Moment has no asset to migrate');
    if (!this.migrationQueue) throw AppError.internal('Migration queue not configured');

    const assetType = moment.assetMetadata?.['fileType'] as string | undefined;
    const job: MigrationJob = {
      assetUrl: moment.assetUrl,
      momentId,
      assetType: assetType ?? 'unknown',
      attempt: 1,
    };

    await this.repo.updateByMomentId(momentId, { zgStatus: 'pending', zgError: undefined });
    await this.migrationQueue.push(job);
    return { message: 'Migration retry queued' };
  }

  async getDaEvents(momentId: string) {
    if (!this.daEventRepo) return { events: [] };
    const events = await this.daEventRepo.findByMoment(momentId);
    return { events };
  }
}

function toResponse(m: MomentModel) {
  return {
    momentId: m.momentId,
    playerWalletAddress: m.playerWalletAddress,
    assetUrl: m.assetUrl,
    assetZgHash: m.assetZgHash,
    metadataZgHash: m.metadataZgHash,
    zgStatus: m.zgStatus,
    assetZgTxHash: m.assetZgTxHash,
    metadataZgTxHash: m.metadataZgTxHash,
    zgError: m.zgError,
    zgUploadedAt: m.zgUploadedAt,
    numLikes: m.numLikes,
    numComments: m.numComments,
    assetMetadata: m.assetMetadata,
    title: m.title,
    description: m.description,
    tags: m.tags,
    relatedGames: m.relatedGames,
    socialMediaLinks: m.socialMediaLinks,
    aiCaption: m.aiCaption,
    aiRankScore: m.aiRankScore,
    aiHighlights: m.aiHighlights,
    aiStatus: m.aiStatus,
    aiMomentType: m.aiMomentType,
    aiSkillScore: m.aiSkillScore,
    aiReactionQuality: m.aiReactionQuality,
    aiRarity: m.aiRarity,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    assetZgUrl: m.assetZgHash ? config.zg.gatewayUrlFor(m.assetZgHash) : null,
    metadataZgUrl: m.metadataZgHash ? config.zg.gatewayUrlFor(m.metadataZgHash) : null,
  };
}
