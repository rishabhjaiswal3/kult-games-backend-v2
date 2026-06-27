import { Db } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import type { PlayerTitleDoc, TitleType } from './player-titles.model';

function normalizeWallet(wallet: string) {
  return wallet.trim().toLowerCase();
}

export class PlayerTitlesRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.playerTitles);
  }

  async findByWallet(wallet: string): Promise<PlayerTitleDoc | null> {
    return this.collection.findOne<PlayerTitleDoc>({
      playerWalletAddress: normalizeWallet(wallet),
    });
  }

  async upsertTitles(wallet: string, types: TitleType[]): Promise<void> {
    const normalized = normalizeWallet(wallet);
    const now = new Date();
    const existing = await this.findByWallet(wallet);

    const existingTypes = new Set((existing?.titles ?? []).map((t) => t.type));
    const newGrants = types
      .filter((t) => !existingTypes.has(t))
      .map((type) => ({ type, grantedAt: now }));

    if (!existing) {
      await this.collection.insertOne({
        playerWalletAddress: normalized,
        titles: newGrants,
        createdAt: now,
        updatedAt: now,
      } as PlayerTitleDoc);
      return;
    }

    if (newGrants.length === 0) return;

    await this.collection.updateOne(
      { playerWalletAddress: normalized },
      {
        $push: { titles: { $each: newGrants } } as never,
        $set: { updatedAt: now },
      },
    );
  }
}
