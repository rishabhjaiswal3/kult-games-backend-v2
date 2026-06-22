import { Db } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { clampKultPoints, createDefaultKultPoints, DEFAULT_KULT_POINTS, KultPointsModel } from './kult-points.model';

export class KultPointsRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.kultPoints);
  }

  async findByWallet(walletAddress: string): Promise<KultPointsModel | null> {
    return this.collection.findOne<KultPointsModel>({ walletAddress });
  }

  async getBalance(walletAddress: string): Promise<number> {
    const entry = await this.findByWallet(walletAddress);
    return clampKultPoints(entry?.kultPoints ?? DEFAULT_KULT_POINTS);
  }

  async setBalance(walletAddress: string, kultPoints: number): Promise<KultPointsModel> {
    const now = new Date();
    const nextKultPoints = clampKultPoints(kultPoints);
    const existing = await this.findByWallet(walletAddress);

    const doc: KultPointsModel = {
      walletAddress,
      kultPoints: nextKultPoints,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.collection.replaceOne({ walletAddress }, doc, { upsert: true });
    return doc;
  }

  async ensureWallet(walletAddress: string): Promise<KultPointsModel> {
    const existing = await this.findByWallet(walletAddress);
    if (existing) return existing;

    const doc = createDefaultKultPoints(walletAddress);
    await this.collection.insertOne(doc);
    return doc;
  }

  async countRankByKultPoints(kultPoints: number): Promise<number> {
    const safe = clampKultPoints(kultPoints);
    if (safe <= 0) return 0;
    return this.collection.countDocuments({ kultPoints: { $gt: safe } });
  }

  async bulkSetBalances(
    entries: Array<{ walletAddress: string; kultPoints: number }>,
  ): Promise<number> {
    if (!entries.length) return 0;

    const now = new Date();
    const ops = entries.map(({ walletAddress, kultPoints }) => ({
      updateOne: {
        filter: { walletAddress },
        update: {
          $set: {
            walletAddress,
            kultPoints: clampKultPoints(kultPoints),
            updatedAt: now,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        upsert: true,
      },
    }));

    const result = await this.collection.bulkWrite(ops, { ordered: false });
    return result.upsertedCount + result.modifiedCount + result.matchedCount;
  }
}
