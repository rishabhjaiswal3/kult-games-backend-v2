import { AppError } from '../../core/error';
import { logger } from '../../db/logger';
import { getMongoClient } from '../../db/mongo';
import {
  GlobalLeaderboardRepository,
  GameLeaderboardConfigRepository,
  GameLeaderboardDataRepository,
} from './leaderboard.repository';
import {
  GlobalLeaderboardModel,
  GlobalLeaderboardResponse,
  GlobalLeaderboardEntryDto,
  GameLeaderboardResponse,
  GameLeaderboardEntryDto,
  LeaderboardEntry,
} from './leaderboard.model';
import { Db, Document } from 'mongodb';
import { KultPointsRepository } from '../kult-points/kult-points.repository';

export class GlobalLeaderboardService {
  constructor(
    private readonly globalRepo: GlobalLeaderboardRepository,
    private readonly configRepo: GameLeaderboardConfigRepository,
    private readonly gameLbService: GameLeaderboardService,
    private readonly kultPointsRepo: KultPointsRepository,
  ) {}

  async getGlobalLeaderboardPaginated(page: number, pageSize: number): Promise<GlobalLeaderboardResponse> {
    const skip = (page - 1) * pageSize;
    const globalCount = await this.globalRepo.countAll();

    if (globalCount > 0) {
      const entries = await this.globalRepo.getGlobalRanking(skip, pageSize);
      const kultPointsByWallet = await this.kultPointsRepo.getBalancesForWallets(
        entries.map((e) => e.walletAddress),
      );

      return {
        entries: entries.map((e, i) => ({
          rank: skip + i + 1,
          walletAddress: e.walletAddress,
          score: e.score,
          kultPoints: kultPointsByWallet.get(e.walletAddress.toLowerCase()) ?? 0,
          level: e.level,
        })),
        totalCount: globalCount,
        page,
        pageSize,
        totalPages: globalCount === 0 ? 0 : Math.ceil(globalCount / pageSize),
      };
    }

    const [kpEntries, totalCount] = await Promise.all([
      this.kultPointsRepo.getPaginated(skip, pageSize),
      this.kultPointsRepo.countAll(),
    ]);

    return {
      entries: kpEntries.map((e, i) => ({
        rank: skip + i + 1,
        walletAddress: e.walletAddress,
        score: 0,
        kultPoints: e.kultPoints,
        level: calculateLevel(e.kultPoints),
      })),
      totalCount,
      page,
      pageSize,
      totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize),
    };
  }

  async refreshGlobalLeaderboard(): Promise<number> {
    logger.info('Starting global leaderboard refresh');

    const configs = await this.configRepo.findAll();
    if (!configs.length) {
      logger.warn('No leaderboard configs found');
      return 0;
    }

    const playerScores = new Map<string, number>();
    const playerWeights = new Map<string, number>();

    for (const cfg of configs) {
      try {
        const entries = await this.gameLbService.fetchAllEntries(cfg.identification);
        for (const entry of entries) {
          const weighted = entry.score * (cfg.weight ?? 1.0);
          playerScores.set(entry.player, (playerScores.get(entry.player) ?? 0) + weighted);
          playerWeights.set(entry.player, (playerWeights.get(entry.player) ?? 0) + (cfg.weight ?? 1.0));
        }
      } catch (err) {
        logger.error({ err, game: cfg.identification }, 'Failed to fetch game scores for refresh');
      }
    }

    const now = new Date();
    const ranked: GlobalLeaderboardModel[] = Array.from(playerScores.entries())
      .sort(([, a], [, b]) => b - a)
      .map(([wallet, score], idx) => ({
        walletAddress: wallet,
        score,
        rank: idx + 1,
        level: calculateLevel(score),
        updatedAt: now,
      }));

    await this.globalRepo.replaceAll(ranked);
    logger.info({ count: ranked.length }, 'Global leaderboard refreshed');
    return ranked.length;
  }
}

export class GameLeaderboardService {
  private readonly dataRepo: GameLeaderboardDataRepository;

  constructor(
    private readonly configRepo: GameLeaderboardConfigRepository,
  ) {
    this.dataRepo = new GameLeaderboardDataRepository((dbName: string) => {
      return getMongoClient().db(dbName) as Db;
    });
  }

  async fetchLeaderboardPaginated(
    identification: string,
    page: number,
    pageSize: number,
  ): Promise<GameLeaderboardResponse> {
    const cfg = await this.configRepo.findByIdentification(identification);
    if (!cfg) throw AppError.notFound(`Leaderboard config not found for '${identification}'`);

    const skip = (page - 1) * pageSize;
    const { entries, totalCount } = await this.dataRepo.fetchLeaderboard(cfg, skip, pageSize);

    const dtos: GameLeaderboardEntryDto[] = entries.map((doc, i) =>
      entryFromDoc(doc, skip + i + 1),
    );

    return {
      entries: dtos,
      totalCount,
      page,
      pageSize,
      totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize),
    };
  }

  async fetchAllEntries(identification: string): Promise<LeaderboardEntry[]> {
    const cfg = await this.configRepo.findByIdentification(identification);
    if (!cfg) return [];

    const { entries } = await this.dataRepo.fetchLeaderboard(cfg, 0, 10_000);
    return entries.map((doc, i) => rawEntry(doc, i + 1));
  }

  async fetchScoresForPlayer(wallet: string): Promise<[string, number, number, number, number | undefined][]> {
    const configs = await this.configRepo.findAll();
    const result: [string, number, number, number, number | undefined][] = [];

    for (const cfg of configs) {
      try {
        const { entries } = await this.dataRepo.fetchLeaderboard(cfg, 0, 10_000);
        const playerEntry = entries.find((e) => {
          const player = String(e['player'] ?? '');
          return player.toLowerCase() === wallet.toLowerCase();
        });

        if (playerEntry) {
          const score = toNumber(playerEntry['score']);
          const weight = cfg.weight ?? 1.0;
          const weighted = score * weight;
          const rank = entries.findIndex((e) => String(e['player'] ?? '').toLowerCase() === wallet.toLowerCase()) + 1;
          result.push([cfg.identification, score, weight, weighted, rank || undefined]);
        }
      } catch (err) {
        logger.warn({ err, game: cfg.identification }, 'Failed to fetch player scores');
      }
    }

    return result;
  }
}

function toGlobalEntryDto(model: GlobalLeaderboardModel, kultPoints = 0): GlobalLeaderboardEntryDto {
  return {
    rank: model.rank,
    walletAddress: model.walletAddress,
    score: model.score,
    kultPoints,
    level: model.level,
  };
}

function entryFromDoc(doc: Document, rank: number): GameLeaderboardEntryDto {
  return {
    rank,
    player: String(doc['player'] ?? 'unknown'),
    score: toNumber(doc['score']),
    metadata: doc['metadata'] ?? undefined,
  };
}

function rawEntry(doc: Document, rank: number): LeaderboardEntry {
  return {
    rank,
    player: String(doc['player'] ?? 'unknown'),
    score: toNumber(doc['score']),
    metadata: doc['metadata'],
  };
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return parseFloat(v) || 0;
  return 0;
}

function calculateLevel(score: number): number {
  if (score >= 100_000) return 100;
  if (score >= 50_000)  return 80;
  if (score >= 10_000)  return 60;
  if (score >= 5_000)   return 40;
  if (score >= 1_000)   return 20;
  return 1;
}
