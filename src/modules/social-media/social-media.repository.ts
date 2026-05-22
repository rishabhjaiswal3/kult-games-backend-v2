import { Db } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { SocialPostModel } from './social-media.model';

export class SocialPostRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.sharedPosts);
  }

  async create(post: SocialPostModel): Promise<void> {
    await this.collection.insertOne({ ...post, created_at: new Date() });
  }

  async findByWallet(wallet: string, skip: number, limit: number): Promise<SocialPostModel[]> {
    return this.collection
      .find<SocialPostModel>({ wallet_address: wallet })
      .sort({ created_at: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
  }

  async existsByPlatformAndPostId(platform: string, postId: string): Promise<boolean> {
    const count = await this.collection.countDocuments({ platform, post_id: postId });
    return count > 0;
  }

  async updateValidationStatus(platform: string, postId: string, status: string, rawData?: unknown): Promise<void> {
    await this.collection.updateOne(
      { platform, post_id: postId },
      { $set: { validation_status: status, raw_data: rawData, scraped_at: new Date() } },
    );
  }

  async findPendingValidation(limit: number): Promise<SocialPostModel[]> {
    return this.collection
      .find<SocialPostModel>({ validation_status: 'pending' })
      .limit(limit)
      .toArray();
  }
}
