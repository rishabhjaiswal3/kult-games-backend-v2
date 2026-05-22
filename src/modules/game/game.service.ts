import { AppError } from '../../core/error';
import { logger } from '../../db/logger';
import { GameRepository } from './game.repository';
import {
  GameModel, Localized, OrientedImage,
  GameListItemDto, GameDetailDto, AllGamesResponse, CategoriesResponse,
} from './game.model';

// Play count sources per game identification slug.
const PLAY_COUNT_SOURCES: Record<string, Array<[string, string]>> = {
  guesstheai:        [['guesstheai', 'guesstheai_users']],
  highwayhustle:     [['highwayhustle', 'highwayhustleplayers']],
  'highway-hustle':  [['highwayhustle', 'highwayhustleplayers']],
  robowars:          [['RoboWar', 'RoboWar']],
  'robo-wars':       [['RoboWar', 'RoboWar']],
  warzonewarriors:   [['new-warzone', 'warzoneplayerprofiles'], ['kult_browser', 'new warzone']],
  warzone:           [['new-warzone', 'warzoneplayerprofiles'], ['kult_browser', 'new warzone']],
  'new-warzone':     [['new-warzone', 'warzoneplayerprofiles'], ['kult_browser', 'new warzone']],
  'warzone-warriors':[['new-warzone', 'warzoneplayerprofiles'], ['kult_browser', 'new warzone']],
  zerodash:          [['zerodash', 'players']],
  'zero-dash':       [['zerodash', 'players']],
  zerogpool:         [['zerogpool', 'userdatas']],
  'zerog-pool':      [['zerogpool', 'userdatas']],
  'zero-g-pool':     [['zerogpool', 'userdatas']],
};

const VECTOR_FACT_ID: Record<string, string> = {
  'highway-hustle':   'highwayhustle',
  'robo-wars':        'robowars',
  'warzone':          'warzonewarriors',
  'new-warzone':      'warzonewarriors',
  'warzone-warriors': 'warzonewarriors',
  'zero-dash':        'zerodash',
  'zerog-pool':       'zerogpool',
  'zero-g-pool':      'zerogpool',
};

export class GameService {
  constructor(private readonly repo: GameRepository) {}

  async getAllGames(search: string | undefined, page: number, pageSize: number): Promise<AllGamesResponse> {
    const skip = Math.max(0, (page - 1)) * pageSize;
    const { games, totalCount } = await this.repo.findAllPaginated(search, skip, pageSize);

    const dtos = await Promise.all(games.map((g) => this.toListItemWithExtras(g)));
    dtos.sort((a, b) => (b.play_count ?? 0) - (a.play_count ?? 0));

    return {
      games: dtos,
      totalCount,
      page,
      pageSize,
      totalPages: totalCount === 0 ? 0 : Math.ceil(totalCount / pageSize),
    };
  }

  async getGameByIdentification(id: string): Promise<{ game: GameDetailDto }> {
    const game = await this.repo.findByIdentification(id);
    if (!game) throw AppError.notFound(`Game '${id}' not found`);

    const dto = await this.toDetailWithExtras(game);
    return { game: dto };
  }

  async getAllCategories(): Promise<CategoriesResponse> {
    const categories = await this.repo.getDistinctCategories();
    return { categories };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async toListItemWithExtras(game: GameModel): Promise<GameListItemDto> {
    const dto: GameListItemDto = {
      identification: game.identification,
      name: game.name,
      thumbnail: game.images.hero,
      isDownloadable: game.isDownloadable,
      category: game.category,
      slogan: game.slogan,
      rating: game.rating,
      metadata: game.metadata,
    };

    const playCount = await this.getPlayCount(game.identification);
    if (playCount !== undefined) {
      dto.play_count = playCount;
      dto.rating = calculateDynamicRating(playCount);
    }

    const facts = await this.getKnowledgeFacts(game.identification);
    if (facts) dto.knowledge_facts = facts;

    return dto;
  }

  private async toDetailWithExtras(game: GameModel): Promise<GameDetailDto> {
    const dto: GameDetailDto = {
      identification: game.identification,
      name: game.name,
      url: game.url,
      thumbnail: game.images.hero,
      isDownloadable: game.isDownloadable,
      category: game.category,
      about: normalizeAbout(game.about),
      rating: game.rating,
      metadata: game.metadata,
    };

    const playCount = await this.getPlayCount(game.identification);
    if (playCount !== undefined) {
      dto.play_count = playCount;
      dto.rating = calculateDynamicRating(playCount);
    }

    const facts = await this.getKnowledgeFacts(game.identification);
    if (facts) dto.knowledge_facts = facts;

    return dto;
  }

  private async getPlayCount(id: string): Promise<number | undefined> {
    const sources = PLAY_COUNT_SOURCES[id] ?? [];
    if (!sources.length) return undefined;

    let best: number | undefined;
    for (const [db, coll] of sources) {
      try {
        const count = await this.repo.getPlayCount(db, coll);
        best = best === undefined ? count : Math.max(best, count);
      } catch (err) {
        logger.warn({ err, id, db, coll }, 'Failed to fetch play count');
      }
    }
    return best;
  }

  private async getKnowledgeFacts(id: string): Promise<string[] | undefined> {
    const gameId = VECTOR_FACT_ID[id] ?? id;
    try {
      const facts = await this.repo.getVectorFacts(gameId, 8);
      return facts.length ? facts : undefined;
    } catch (err) {
      logger.warn({ err, id }, 'Failed to fetch knowledge facts');
      return undefined;
    }
  }
}

function calculateDynamicRating(playCount: number): number {
  if (playCount >= 100_000) return 5.0;
  if (playCount >= 50_000)  return 4.9;
  if (playCount >= 10_000)  return 4.8;
  if (playCount >= 5_000)   return 4.7;
  if (playCount >= 1_000)   return 4.5;
  if (playCount >= 100)     return 4.2;
  return 4.0;
}

function normalizeAbout(about: unknown): Localized<string> | undefined {
  if (!about || about === null) return undefined;

  // Already localized shape: { en: "...", ... }
  if (typeof about === 'object' && !Array.isArray(about)) {
    const obj = about as Record<string, unknown>;
    if (typeof obj['en'] === 'string') return obj as Localized<string>;

    // Rich text array format
    if (Array.isArray(about)) {
      const text = extractAboutText(about);
      return text ? { en: text } : undefined;
    }

    // Try extracting text from object
    const text = extractAboutSection(obj);
    return text ? { en: text } : undefined;
  }

  if (Array.isArray(about)) {
    const text = extractAboutText(about);
    return text ? { en: text } : undefined;
  }

  if (typeof about === 'string' && about.trim()) {
    return { en: about.trim() };
  }

  return undefined;
}

function extractAboutText(items: unknown[]): string | undefined {
  const sections = items
    .map((i) => extractAboutSection(i as Record<string, unknown>))
    .filter((s): s is string => !!s);
  return sections.length ? sections.join('\n\n') : undefined;
}

function extractAboutSection(obj: unknown): string | undefined {
  if (typeof obj === 'string') return obj.trim() || undefined;
  if (typeof obj !== 'object' || !obj) return undefined;

  const o = obj as Record<string, unknown>;
  const title = typeof o['title'] === 'string' ? o['title'].trim() : undefined;
  const body = extractContentText(o['content'] ?? o['data']);

  if (title && body) return `${title}\n${body}`;
  return title ?? body;
}

function extractContentText(v: unknown): string | undefined {
  if (typeof v === 'string') return v.trim() || undefined;
  if (Array.isArray(v)) {
    const lines = v.map((i) => (typeof i === 'string' ? i.trim() : '')).filter(Boolean);
    return lines.length ? lines.join('\n') : undefined;
  }
  if (typeof v === 'object' && v) {
    return extractContentText((v as Record<string, unknown>)['data']);
  }
  return undefined;
}
