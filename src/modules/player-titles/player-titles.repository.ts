import { Db } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import type { PlayerTitleDoc, TitleType } from './player-titles.model';

function normalizeWallet(wallet: string) {
  return wallet.trim().toLowerCase();
}

// Case-insensitive filter — handles mixed-case addresses inserted directly into DB
function walletFilter(wallet: string) {
  const escaped = normalizeWallet(wallet).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { playerWalletAddress: { $regex: new RegExp(`^${escaped}$`, 'i') } };
}

export class PlayerTitlesRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.playerTitles);
  }

  async findByWallet(wallet: string): Promise<PlayerTitleDoc | null> {
    return this.collection.findOne<PlayerTitleDoc>(walletFilter(wallet));
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
      walletFilter(wallet),
      {
        $push: { titles: { $each: newGrants } } as never,
        $set: { updatedAt: now },
      },
    );
  }
}
