import { Db } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import type { DailyRewardsDoc } from './daily-rewards.model';

function normalizeWallet(wallet: string): string {
  return wallet.trim().toLowerCase();
}

function walletFilter(wallet: string) {
  const escaped = normalizeWallet(wallet).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { walletAddress: { $regex: new RegExp(`^${escaped}$`, 'i') } };
}

export class DailyRewardsRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.dailyRewards);
  }

  async findByWallet(wallet: string): Promise<DailyRewardsDoc | null> {
    return this.collection.findOne<DailyRewardsDoc>(walletFilter(wallet));
  }

  async createRecord(input: {
    walletAddress: string;
    claimedDays: number[];
    firstClaimAt: Date;
    lastClaimedAt: Date;
  }): Promise<DailyRewardsDoc> {
    const now = new Date();
    const wallet = normalizeWallet(input.walletAddress);
    const doc: DailyRewardsDoc = {
      walletAddress: wallet,
      claimedDays: [...new Set(input.claimedDays)].sort((a, b) => a - b),
      firstClaimAt: input.firstClaimAt,
      lastClaimedAt: input.lastClaimedAt,
      createdAt: now,
      updatedAt: now,
    };

    await this.collection.insertOne(doc);
    return doc;
  }

  async appendClaimedDay(wallet: string, day: number, claimedAt: Date): Promise<DailyRewardsDoc> {
    const existing = await this.findByWallet(wallet);
    if (!existing) {
      throw new Error('Daily rewards record not found');
    }

    const claimedDays = [...new Set([...existing.claimedDays, day])].sort((a, b) => a - b);
    await this.collection.updateOne(walletFilter(wallet), {
      $set: {
        claimedDays,
        lastClaimedAt: claimedAt,
        updatedAt: new Date(),
      },
    });

    return {
      ...existing,
      claimedDays,
      lastClaimedAt: claimedAt,
      updatedAt: new Date(),
    };
  }
}
