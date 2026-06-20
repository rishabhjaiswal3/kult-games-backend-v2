import { MongoClient, Db, IndexDescription } from 'mongodb';
import { config } from '../config';
import { logger } from './logger';

let client: MongoClient;
let db: Db;

export async function connectMongo(): Promise<Db> {
  const { mongoUri, mongoDbName, mongoRetries } = config.db;

  for (let attempt = 1; attempt <= mongoRetries; attempt++) {
    try {
      client = new MongoClient(mongoUri);
      await client.connect();
      db = client.db(mongoDbName);
      logger.info({ db: mongoDbName }, 'MongoDB connected');
      return db;
    } catch (err) {
      logger.error({ err, attempt }, 'MongoDB connection failed');
      if (attempt === mongoRetries) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  throw new Error('MongoDB connection exhausted');
}

export function getDb(): Db {
  if (!db) throw new Error('MongoDB not connected — call connectMongo() first');
  return db;
}

export function getMongoClient(): MongoClient {
  if (!client) throw new Error('MongoDB not connected');
  return client;
}

// ── Index definitions ──────────────────────────────────────────────────────────

export async function ensureIndexes(database: Db): Promise<void> {
  const col = config.db.col;

  await Promise.allSettled([
    createIndexes(database, col.players, [
      { key: { walletAddress: 1 }, unique: true },
      { key: { referralCode: 1 }, sparse: true },
    ]),
    createIndexes(database, col.nonces, [
      { key: { createdAt: 1 }, expireAfterSeconds: 300 },
      { key: { walletAddress: 1, nonce: 1 }, unique: true },
    ]),
    createIndexes(database, col.games, [
      { key: { identification: 1 }, unique: true },
    ]),
    createIndexes(database, col.globalLeaderboard, [
      { key: { walletAddress: 1 }, unique: true },
      { key: { score: -1 } },
    ]),
    createIndexes(database, col.gameLbConfig, [
      { key: { identification: 1 }, unique: true },
    ]),
    createIndexes(database, col.content, [
      { key: { page: 1, section: 1 }, unique: true },
    ]),
    createIndexes(database, col.aiModels, [
      { key: { ownerWallet: 1 }, unique: true },
      { key: { agentWallet: 1 }, unique: true },
    ]),
    createIndexes(database, col.moments, [
      { key: { momentId: 1 }, unique: true },
      { key: { playerWalletAddress: 1, createdAt: -1 } },
      { key: { relatedGames: 1, createdAt: -1 } },
    ]),
    createIndexes(database, col.momentComments, [
      { key: { momentId: 1, parentCommentId: 1, createdAt: 1 } },
    ]),
    createIndexes(database, col.momentLikes, [
      { key: { momentId: 1, authorWalletAddress: 1 }, unique: true },
    ]),
    createIndexes(database, col.sharedPosts, [
      { key: { wallet_address: 1, created_at: -1 } },
      { key: { platform: 1, post_id: 1 }, unique: true },
    ]),
    createIndexes(database, col.onchainJobs, [
      { key: { activityId: 1 }, unique: true },
      { key: { status: 1, createdAt: 1 } },
      { key: { userWallet: 1, createdAt: -1 } },
    ]),
    createIndexes(database, 'store_referrals', [
      { key: { referred_player_id: 1 }, unique: true },
    ]),
    createIndexes(database, 'store_referral_scores', [
      { key: { walletAddress: 1 }, unique: true },
    ]),
  ]);

  // These constraints enforce marketplace idempotency and must not fail silently.
  await createIndexes(database, col.orders, [
    { key: { orderId: 1 }, unique: true },
    {
      key: { txHash: 1 },
      unique: true,
      partialFilterExpression: { txHash: { $type: 'string' } },
    },
    { key: { playerId: 1, createdAt: -1 } },
  ], true);

  logger.info('MongoDB indexes initialized');
}

async function createIndexes(
  database: Db,
  collectionName: string,
  indexes: Array<{
    key: Record<string, 1 | -1>;
    unique?: boolean;
    sparse?: boolean;
    expireAfterSeconds?: number;
    partialFilterExpression?: Record<string, unknown>;
  }>,
  failOnError = false,
): Promise<void> {
  const coll = database.collection(collectionName);
  for (const idx of indexes) {
    try {
      await coll.createIndex(idx.key, {
        unique: idx.unique,
        sparse: idx.sparse,
        expireAfterSeconds: idx.expireAfterSeconds,
        partialFilterExpression: idx.partialFilterExpression,
      });
    } catch (err) {
      logger.error({ err, collection: collectionName }, 'Failed to create index');
      if (failOnError) throw err;
    }
  }
}
