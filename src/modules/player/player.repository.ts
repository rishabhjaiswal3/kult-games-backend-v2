import { Db, ReturnDocument } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { PlayerModel, NonceModel } from './player.model';

export class PlayerRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.players);
  }

  async findByWallet(wallet: string): Promise<PlayerModel | null> {
    return this.collection.findOne<PlayerModel>({ walletAddress: wallet });
  }

  async findOrCreate(
    wallet: string,
    name: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ player: PlayerModel; isNew: boolean }> {
    const now = new Date();

    const result = await this.collection.findOneAndUpdate(
      { walletAddress: wallet },
      {
        $setOnInsert: { walletAddress: wallet, name, metadata: metadata ?? null, createdAt: now },
        $set: { updatedAt: now },
      },
      { upsert: true, returnDocument: ReturnDocument.AFTER },
    );

    const player = result as unknown as PlayerModel;
    const isNew = !!(result as { lastErrorObject?: { upserted?: unknown } })?.lastErrorObject?.upserted
      || (result as unknown as { upsertedCount?: number })?.upsertedCount === 1;

    // If the player already existed, check by createdAt proximity
    const wasJustCreated = player.createdAt
      ? Math.abs(player.createdAt.getTime() - now.getTime()) < 1000
      : false;

    return { player, isNew: isNew || wasJustCreated };
  }

  async updateName(wallet: string, name: string): Promise<PlayerModel | null> {
    const result = await this.collection.findOneAndUpdate(
      { walletAddress: wallet },
      { $set: { name, updatedAt: new Date() } },
      { returnDocument: ReturnDocument.AFTER },
    );
    return result as unknown as PlayerModel | null;
  }

  async updateReferralCode(wallet: string, code: string): Promise<void> {
    await this.collection.updateOne(
      { walletAddress: wallet },
      { $set: { referralCode: code, updatedAt: new Date() } },
    );
  }

  async findByReferralCode(code: string): Promise<PlayerModel | null> {
    return this.collection.findOne<PlayerModel>({ referralCode: code });
  }
}

export class NonceRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.nonces);
  }

  async createNonce(wallet: string, nonce: string): Promise<void> {
    await this.collection.insertOne({ walletAddress: wallet, nonce, createdAt: new Date() } as NonceModel);
  }

  async consumeNonce(wallet: string, nonce: string): Promise<boolean> {
    const result = await this.collection.findOneAndDelete({ walletAddress: wallet, nonce });
    return result !== null;
  }
}
