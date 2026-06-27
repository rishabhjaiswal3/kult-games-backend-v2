import { Db, Document } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { MomentModel, MomentLikeModel, DaEventModel, MomentBookmarkModel, MomentWatchHistoryModel } from './moments.model';

export type MomentSortBy = 'newest' | 'most_liked' | 'top_creator';
export type MomentMode   = 'ai_arena' | 'trash_talk' | 'league';
export type MomentDate   = 'last_24h' | 'this_week' | 'this_month';

export interface MomentFeedOptions {
  tags?: string[];
  search?: string;
  mediaType?: 'image' | 'video';
  game?: string;
  mode?: MomentMode;
  dateWindow?: MomentDate;
  sortBy?: MomentSortBy;
}

function buildModeFilter(mode: MomentMode): Document {
  if (mode === 'ai_arena') {
    return {
      $or: [
        { 'assetMetadata.mode': { $regex: /^ai.?arena$/i } },
        { relatedGames: { $in: ['robowars', 'guesstheai', 'zerodash', 'zerogpool'] } },
        { tags:  { $in: ['aiarena', 'ai arena'] } },
        { title: { $regex: /ai.?arena/i } },
      ],
    };
  }
  if (mode === 'trash_talk') {
    return {
      $or: [
        { 'assetMetadata.mode': { $regex: /^trash.?talk$/i } },
        { tags:  { $in: ['trashtalk', 'trash talk'] } },
        { title: { $regex: /trash.?talk/i } },
      ],
    };
  }
  // league
  return {
    $or: [
      { 'assetMetadata.mode': { $regex: /^league$/i } },
      { tags:  'league' },
      { title: { $regex: /league/i } },
    ],
  };
}

function buildDateFilter(dateWindow: MomentDate): Document {
  const now = new Date();
  if (dateWindow === 'last_24h') {
    return { createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } };
  }
  if (dateWindow === 'this_week') {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    return { createdAt: { $gte: start } };
  }
  // this_month
  return { createdAt: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) } };
}

export class MomentsRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.moments);
  }

  async create(moment: MomentModel): Promise<void> {
    await this.collection.insertOne({ ...moment, createdAt: new Date(), updatedAt: new Date() });
  }

  async findByMomentId(momentId: string): Promise<MomentModel | null> {
    return this.collection.findOne<MomentModel>({ momentId });
  }

  async getFeed(
    skip: number,
    limit: number,
    options: MomentFeedOptions = {},
  ): Promise<{ moments: MomentModel[]; totalCount: number }> {
    const { tags, search, mediaType, game, mode, dateWindow, sortBy = 'newest' } = options;

    const filter: Document = {};

    if (tags?.length)  filter['tags'] = { $in: tags };
    if (game)          filter['relatedGames'] = game;
    if (mode)          Object.assign(filter, buildModeFilter(mode));
    if (dateWindow)    Object.assign(filter, buildDateFilter(dateWindow));

    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter['$or'] = [{ title: re }, { description: re }, { tags: re }];
    }
    if (mediaType === 'image') {
      filter['assetMetadata.fileType'] = { $regex: /^image\//i };
    } else if (mediaType === 'video') {
      filter['assetMetadata.fileType'] = { $regex: /^video\//i };
    }

    const totalCount = await this.collection.countDocuments(filter);

    let moments: MomentModel[];

    if (sortBy === 'top_creator') {
      // Group by creator → rank by moment count → unwind → sort by rank then recency
      const pipeline = [
        { $match: filter },
        { $group: { _id: '$playerWalletAddress', _count: { $sum: 1 }, _docs: { $push: '$$ROOT' } } },
        { $unwind: '$_docs' },
        { $replaceRoot: { newRoot: { $mergeObjects: ['$_docs', { _creatorCount: '$_count' }] } } },
        { $sort: { _creatorCount: -1, createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $project: { _creatorCount: 0 } },
      ];
      moments = await this.collection.aggregate<MomentModel>(pipeline).toArray();
    } else {
      const sort: Document = sortBy === 'most_liked'
        ? { numLikes: -1, createdAt: -1 }
        : { createdAt: -1 };

      moments = await this.collection
        .find<MomentModel>(filter)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .toArray();
    }

    return { moments, totalCount };
  }

  async getPlayerMoments(wallet: string, skip: number, limit: number): Promise<{ moments: MomentModel[]; totalCount: number }> {
    const filter = { playerWalletAddress: wallet };
    const [moments, totalCount] = await Promise.all([
      this.collection.find<MomentModel>(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      this.collection.countDocuments(filter),
    ]);
    return { moments, totalCount };
  }

  async update(momentId: string, wallet: string, patch: Partial<MomentModel>): Promise<MomentModel | null> {
    const result = await this.collection.findOneAndUpdate(
      { momentId, playerWalletAddress: wallet },
      { $set: { ...patch, updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    return result as unknown as MomentModel | null;
  }

  async updateByMomentId(momentId: string, patch: Partial<MomentModel>): Promise<void> {
    await this.collection.updateOne({ momentId }, { $set: { ...patch, updatedAt: new Date() } });
  }

  async delete(momentId: string, wallet: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ momentId, playerWalletAddress: wallet });
    return result.deletedCount > 0;
  }

  async incrementLikes(momentId: string, delta: 1 | -1): Promise<void> {
    await this.collection.updateOne({ momentId }, { $inc: { numLikes: delta } });
  }

  async incrementNumComments(momentId: string, delta: number): Promise<boolean> {
    const result = await this.collection.updateOne(
      { momentId },
      { $inc: { numComments: delta }, $set: { updatedAt: new Date() } },
    );
    return result.matchedCount > 0;
  }

  async findByMomentIds(momentIds: string[]): Promise<MomentModel[]> {
    if (!momentIds.length) return [];
    const docs = await this.collection
      .find<MomentModel>({ momentId: { $in: momentIds } })
      .toArray();
    const byId = new Map(docs.map((d) => [d.momentId, d]));
    return momentIds.map((id) => byId.get(id)).filter((d): d is MomentModel => Boolean(d));
  }

  async getTopCreators(limit: number): Promise<Array<{ walletAddress: string; momentCount: number }>> {
    const pipeline = [
      { $group: { _id: '$playerWalletAddress', momentCount: { $sum: 1 } } },
      { $match: { momentCount: { $gt: 0 } } },
      { $sort: { momentCount: -1 } },
      { $limit: limit },
      { $project: { _id: 0, walletAddress: '$_id', momentCount: 1 } },
    ];
    return this.collection
      .aggregate<{ walletAddress: string; momentCount: number }>(pipeline)
      .toArray();
  }

  async findPendingMigration(limit: number): Promise<MomentModel[]> {
    return this.collection
      .find<MomentModel>({ zgStatus: 'pending', assetUrl: { $exists: true, $ne: null } })
      .limit(limit)
      .toArray();
  }
}

export class MomentLikesRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.momentLikes);
  }

  async like(momentId: string, wallet: string): Promise<{ alreadyLiked: boolean }> {
    try {
      await this.collection.insertOne({
        momentId,
        authorWalletAddress: wallet,
        createdAt: new Date(),
      } as MomentLikeModel);
      return { alreadyLiked: false };
    } catch {
      return { alreadyLiked: true };
    }
  }

  async unlike(momentId: string, wallet: string): Promise<boolean> {
    const result = await this.collection.deleteOne({ momentId, authorWalletAddress: wallet });
    return result.deletedCount > 0;
  }

  async hasLiked(momentId: string, wallet: string): Promise<boolean> {
    const count = await this.collection.countDocuments({ momentId, authorWalletAddress: wallet });
    return count > 0;
  }
}

export class DaEventRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.daEvents);
  }

  async record(momentId: string, eventType: string, payload?: unknown): Promise<void> {
    await this.collection.insertOne({
      momentId,
      eventType,
      payload,
      createdAt: new Date(),
    } as DaEventModel);
  }

  async findByMoment(momentId: string): Promise<DaEventModel[]> {
    return this.collection
      .find<DaEventModel>({ momentId })
      .sort({ createdAt: -1 })
      .toArray();
  }
}

export class BookmarksRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.momentBookmarks);
  }

  async toggle(momentId: string, wallet: string): Promise<{ bookmarked: boolean }> {
    const existing = await this.collection.findOne({ momentId, playerWalletAddress: wallet });
    if (existing) {
      await this.collection.deleteOne({ momentId, playerWalletAddress: wallet });
      return { bookmarked: false };
    }
    await this.collection.insertOne({
      momentId,
      playerWalletAddress: wallet,
      createdAt: new Date(),
    } as MomentBookmarkModel);
    return { bookmarked: true };
  }

  async isBookmarked(momentId: string, wallet: string): Promise<boolean> {
    const count = await this.collection.countDocuments({ momentId, playerWalletAddress: wallet });
    return count > 0;
  }

  async getPage(wallet: string, skip: number, limit: number): Promise<{ momentIds: string[]; totalCount: number }> {
    const [docs, totalCount] = await Promise.all([
      this.collection
        .find<MomentBookmarkModel>({ playerWalletAddress: wallet })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      this.collection.countDocuments({ playerWalletAddress: wallet }),
    ]);
    return { momentIds: docs.map((d) => d.momentId), totalCount };
  }
}

export class WatchHistoryRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.momentWatchHistory);
  }

  async addWatch(wallet: string, momentId: string): Promise<void> {
    await this.collection.updateOne(
      { playerWalletAddress: wallet },
      [
        {
          $set: {
            playerWalletAddress: wallet,
            momentIds: {
              $slice: [
                {
                  $concatArrays: [
                    [momentId],
                    {
                      $filter: {
                        input: { $ifNull: ['$momentIds', []] },
                        as: 'id',
                        cond: { $ne: ['$$id', momentId] },
                      },
                    },
                  ],
                },
                20,
              ],
            },
            updatedAt: '$$NOW',
          },
        },
      ] as Document[],
      { upsert: true },
    );
  }

  async getPage(wallet: string, skip: number, limit: number): Promise<{ momentIds: string[]; totalCount: number }> {
    const doc = await this.collection.findOne<MomentWatchHistoryModel>({ playerWalletAddress: wallet });
    const allIds = doc?.momentIds ?? [];
    return {
      momentIds: allIds.slice(skip, skip + limit),
      totalCount: allIds.length,
    };
  }
}
