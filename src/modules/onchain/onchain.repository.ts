import { Db } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { OnchainActivityJob } from './onchain.model';

export class OnchainActivityRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.onchainJobs);
  }

  async create(job: OnchainActivityJob): Promise<void> {
    await this.collection.insertOne(job);
  }

  async findPending(limit: number): Promise<OnchainActivityJob[]> {
    return this.collection
      .find<OnchainActivityJob>({ status: 'pending' })
      .sort({ createdAt: 1 })
      .limit(limit)
      .toArray();
  }

  async markSubmitted(activityId: string, txHash: string): Promise<void> {
    await this.collection.updateOne(
      { activityId },
      { $set: { status: 'submitted', txHash, updatedAt: new Date() }, $inc: { attempts: 1 } },
    );
  }

  async markConfirmed(activityId: string): Promise<void> {
    await this.collection.updateOne(
      { activityId },
      { $set: { status: 'confirmed', updatedAt: new Date() } },
    );
  }

  async markFailed(activityId: string, reason: string): Promise<void> {
    await this.collection.updateOne(
      { activityId },
      { $set: { status: 'failed', lastError: reason, updatedAt: new Date() }, $inc: { attempts: 1 } },
    );
  }
}
