import { Db } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { clampKultPoints, createDefaultKultPoints, DEFAULT_KULT_POINTS, KultPointsModel } from './kult-points.model';

function normalizeWalletKey(walletAddress: string): string {
  return String(walletAddress || '').trim().toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class KultPointsRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.kultPoints);
  }

  async findByWallet(walletAddress: string): Promise<KultPointsModel | null> {
    const wallet = normalizeWalletKey(walletAddress);
    return (
      await this.collection.findOne<KultPointsModel>({ walletAddress: wallet })
    ) ?? (
      await this.collection.findOne<KultPointsModel>({
        walletAddress: { $regex: `^${escapeRegex(wallet)}$`, $options: 'i' },
      })
    );
  }

  async findWalletVariants(walletAddress: string): Promise<KultPointsModel[]> {
    const wallet = normalizeWalletKey(walletAddress);
    if (!wallet) return [];
    return this.collection
      .find<KultPointsModel>({
        walletAddress: { $regex: `^${escapeRegex(wallet)}$`, $options: 'i' },
      })
      .toArray();
  }

  async getBalance(walletAddress: string): Promise<number> {
    const entries = await this.findWalletVariants(walletAddress);
    if (!entries.length) return DEFAULT_KULT_POINTS;
    return clampKultPoints(entries.reduce((sum, entry) => sum + clampKultPoints(entry.kultPoints), 0));
  }

  async setBalance(walletAddress: string, kultPoints: number): Promise<KultPointsModel> {
    const now = new Date();
    const wallet = normalizeWalletKey(walletAddress);
    const nextKultPoints = clampKultPoints(kultPoints);
    const variants = await this.findWalletVariants(wallet);
    const existing = variants.find((entry) => entry.walletAddress === wallet) ?? variants[0];

    const doc: KultPointsModel = {
      walletAddress: wallet,
      kultPoints: nextKultPoints,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.collection.replaceOne({ walletAddress: wallet }, doc, { upsert: true });
    const duplicateIds = variants.flatMap((entry) => (
      entry.walletAddress !== wallet && entry._id ? [entry._id] : []
    ));
    if (duplicateIds.length) {
      await this.collection.deleteMany({ _id: { $in: duplicateIds } });
    }
    return doc;
  }

  async ensureWallet(walletAddress: string): Promise<KultPointsModel> {
    const wallet = normalizeWalletKey(walletAddress);
    const existing = await this.findByWallet(wallet);
    if (existing) return existing;

    const doc = createDefaultKultPoints(wallet);
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
    const merged = new Map<string, number>();
    for (const { walletAddress, kultPoints } of entries) {
      const wallet = normalizeWalletKey(walletAddress);
      if (!wallet) continue;
      merged.set(wallet, (merged.get(wallet) ?? 0) + clampKultPoints(kultPoints));
    }

    const ops = Array.from(merged.entries()).map(([walletAddress, kultPoints]) => ({
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

    if (!ops.length) return 0;

    const result = await this.collection.bulkWrite(ops, { ordered: false });
    return result.upsertedCount + result.modifiedCount + result.matchedCount;
  }
}
