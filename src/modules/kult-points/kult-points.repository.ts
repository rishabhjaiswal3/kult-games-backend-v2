import { Db } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { clampKultPoints, DEFAULT_KULT_POINTS, KultPointsModel } from './kult-points.model';

export class KultPointsRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.kultPoints);
  }

  async findByWallet(wallet: string): Promise<KultPointsModel | null> {
    return this.collection.findOne<KultPointsModel>({ walletAddress: wallet });
  }

  async getBalance(wallet: string): Promise<number> {
    const entry = await this.findByWallet(wallet);
    return clampKultPoints(entry?.kultPoints ?? DEFAULT_KULT_POINTS);
  }

  async countRankByKultPoints(kultPoints: number): Promise<number> {
    const safe = clampKultPoints(kultPoints);
    if (safe <= 0) return 0;
    return this.collection.countDocuments({ kultPoints: { $gt: safe } });
  }
}
