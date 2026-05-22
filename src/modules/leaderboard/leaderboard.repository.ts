import { Db, Document } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { GlobalLeaderboardModel, GameLeaderboardConfig } from './leaderboard.model';

export class GlobalLeaderboardRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.globalLeaderboard);
  }

  async getGlobalRanking(skip: number, limit: number): Promise<GlobalLeaderboardModel[]> {
    return this.collection
      .find<GlobalLeaderboardModel>({})
      .sort({ score: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
  }

  async countAll(): Promise<number> {
    return this.collection.countDocuments({});
  }

  async getPlayerEntry(wallet: string): Promise<GlobalLeaderboardModel | null> {
    return this.collection.findOne<GlobalLeaderboardModel>({ walletAddress: wallet });
  }

  async replaceAll(entries: GlobalLeaderboardModel[]): Promise<void> {
    if (!entries.length) {
      await this.collection.deleteMany({});
      return;
    }

    const activeWallets = entries.map((e) => e.walletAddress);

    for (const entry of entries) {
      await this.collection.replaceOne(
        { walletAddress: entry.walletAddress },
        entry,
        { upsert: true },
      );
    }

    await this.collection.deleteMany({ walletAddress: { $nin: activeWallets } });
  }
}

export class GameLeaderboardConfigRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.gameLbConfig);
  }

  async findAll(): Promise<GameLeaderboardConfig[]> {
    return this.collection.find<GameLeaderboardConfig>({}).toArray();
  }

  async findByIdentification(id: string): Promise<GameLeaderboardConfig | null> {
    return this.collection.findOne<GameLeaderboardConfig>({ identification: id });
  }

  async upsert(cfg: GameLeaderboardConfig): Promise<void> {
    await this.collection.replaceOne(
      { identification: cfg.identification },
      cfg,
      { upsert: true },
    );
  }
}

// ── Game leaderboard data fetched from game-specific databases ────────────────

export class GameLeaderboardDataRepository {
  constructor(private readonly getDb: (dbName: string) => Db) {}

  async fetchLeaderboard(
    cfg: GameLeaderboardConfig,
    skip: number,
    limit: number,
  ): Promise<{ entries: Document[]; totalCount: number }> {
    const db = this.getDb(cfg.db);
    const coll = db.collection<Document>(cfg.collection);

    const [totalCount, entries] = await Promise.all([
      coll.countDocuments({}),
      coll
        .aggregate<Document>(buildLeaderboardPipeline(cfg, skip, limit))
        .toArray(),
    ]);

    return { entries, totalCount };
  }
}

function buildLeaderboardPipeline(cfg: GameLeaderboardConfig, skip: number, limit: number): Document[] {
  const project: Document = {
    player: `$${cfg.personKey}`,
    score: `$${cfg.scoreKey}`,
  };

  if (cfg.projection?.length) {
    project['metadata'] = buildMetadataProjection(cfg.projection);
  }

  return [
    { $project: project },
    { $sort: { score: cfg.order } },
    { $skip: skip },
    { $limit: limit },
  ];
}

function buildMetadataProjection(paths: string[]): Document {
  const result: Document = {};

  for (const rawPath of paths) {
    const path = rawPath.trim();
    if (!path) continue;
    const parts = path.split('.').filter(Boolean);
    insertNestedPath(result, parts, path);
  }

  return result;
}

function insertNestedPath(target: Document, parts: string[], sourcePath: string): void {
  if (parts.length === 1) {
    target[parts[0]!] = `$${sourcePath}`;
    return;
  }
  const [head, ...rest] = parts;
  if (!target[head!] || typeof target[head!] !== 'object') {
    target[head!] = {};
  }
  insertNestedPath(target[head!] as Document, rest, sourcePath);
}
