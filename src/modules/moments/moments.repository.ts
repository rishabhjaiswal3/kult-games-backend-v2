import { Db, Document } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { MomentModel, MomentLikeModel, DaEventModel } from './moments.model';

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
    tags?: string[],
    search?: string,
    mediaType?: 'image' | 'video',
  ): Promise<{ moments: MomentModel[]; totalCount: number }> {
    const filter: Document = {};
    if (tags?.length) filter['tags'] = { $in: tags };
    if (search) {
      const re = new RegExp(search, 'i');
      filter['$or'] = [{ title: re }, { description: re }, { tags: re }];
    }
    if (mediaType === 'image') {
      filter['assetMetadata.fileType'] = { $regex: /^image\//i };
    } else if (mediaType === 'video') {
      filter['assetMetadata.fileType'] = { $regex: /^video\//i };
    }

    const [moments, totalCount] = await Promise.all([
      this.collection.find<MomentModel>(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).toArray(),
      this.collection.countDocuments(filter),
    ]);
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
