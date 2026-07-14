import { Db } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import type { DailyActivityDoc } from './daily-activity.model';

function normalizeWallet(wallet: string): string {
  return wallet.trim().toLowerCase();
}

/** UTC date key YYYY-MM-DD */
export function utcActivityDateKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export class DailyActivityRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.dailyActivity);
  }

  /**
   * Records a successful login. One document per wallet per UTC day;
   * repeat logins the same day bump loginCount and lastLoginAt.
   */
  async recordLogin(walletAddress: string, ip?: string): Promise<DailyActivityDoc> {
    const wallet = normalizeWallet(walletAddress);
    const now = new Date();
    const activityDate = utcActivityDateKey(now);

    const result = await this.collection.findOneAndUpdate(
      { walletAddress: wallet, activityDate },
      {
        $setOnInsert: {
          walletAddress: wallet,
          activityDate,
          firstLoginAt: now,
          createdAt: now,
        },
        $set: {
          lastLoginAt: now,
          updatedAt: now,
          ...(ip ? { lastLoginIp: ip } : {}),
        },
        $inc: { loginCount: 1 },
      },
      { upsert: true, returnDocument: 'after' },
    );

    return result as unknown as DailyActivityDoc;
  }
}
