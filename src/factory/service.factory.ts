// Factory Method Pattern — creates and wires all services.
// Each create*() method is a factory method: it builds the service with its dependencies,
// returns a singleton instance, and hides the wiring from callers.

import { Db } from 'mongodb';
import { Redis } from 'ioredis';
import { ValkyQueue } from '../db/redis';
import { config, QUEUES } from '../config';

// Repositories
import { PlayerRepository, NonceRepository } from '../modules/player/player.repository';
import { AgentRepository } from '../modules/agent/agent.repository';
import { GameRepository } from '../modules/game/game.repository';
import { ContentRepository } from '../modules/content/content.repository';
import { GlobalLeaderboardRepository, GameLeaderboardConfigRepository } from '../modules/leaderboard/leaderboard.repository';
import { ListingRepository, OrderRepository } from '../modules/marketplace/marketplace.repository';
import { MomentsRepository, MomentLikesRepository, DaEventRepository } from '../modules/moments/moments.repository';
import { CommentsRepository } from '../modules/moments/comments.repository';
import { CommentsService } from '../modules/moments/comments.service';
import { SocialPostRepository } from '../modules/social-media/social-media.repository';
import { OnchainActivityRepository } from '../modules/onchain/onchain.repository';

// Services
import { PlayerService } from '../modules/player/player.service';
import { GameService } from '../modules/game/game.service';
import { ContentService } from '../modules/content/content.service';
import { GlobalLeaderboardService, GameLeaderboardService } from '../modules/leaderboard/leaderboard.service';
import { MarketplaceService } from '../modules/marketplace/marketplace.service';
import { MomentsService } from '../modules/moments/moments.service';
import { SocialMediaService } from '../modules/social-media/social-media.service';
import { ReferralService } from '../modules/referral/referral.service';
import { OnchainActivityService } from '../modules/onchain/onchain.service';
import { AccessCodeService } from '../modules/access/access-code.service';

export class ServiceFactory {
  // Singleton cache — each service is created exactly once.
  private readonly cache = new Map<string, unknown>();

  constructor(
    private readonly db: Db,
    private readonly redis: Redis,
  ) {}

  // ── Repositories ────────────────────────────────────────────────────────────

  private playerRepo()          { return this.singleton('playerRepo',     () => new PlayerRepository(this.db)); }
  private nonceRepo()           { return this.singleton('nonceRepo',      () => new NonceRepository(this.db)); }
  private agentRepo()           { return this.singleton('agentRepo',      () => new AgentRepository(this.db)); }
  private gameRepo()            { return this.singleton('gameRepo',       () => new GameRepository(this.db)); }
  private contentRepo()         { return this.singleton('contentRepo',    () => new ContentRepository(this.db)); }
  private globalLbRepo()        { return this.singleton('globalLbRepo',   () => new GlobalLeaderboardRepository(this.db)); }
  private gameLbConfigRepo()    { return this.singleton('gameLbCfgRepo',  () => new GameLeaderboardConfigRepository(this.db)); }
  private listingRepo()         { return this.singleton('listingRepo',    () => new ListingRepository(this.db)); }
  private orderRepo()           { return this.singleton('orderRepo',      () => new OrderRepository(this.db)); }
  private momentsRepo()         { return this.singleton('momentsRepo',    () => new MomentsRepository(this.db)); }
  private likesRepo()           { return this.singleton('likesRepo',      () => new MomentLikesRepository(this.db)); }
  private daEventRepo()         { return this.singleton('daEventRepo',    () => new DaEventRepository(this.db)); }
  private commentsRepo()        { return this.singleton('commentsRepo',   () => new CommentsRepository(this.db)); }
  private socialPostRepo()      { return this.singleton('socialPostRepo', () => new SocialPostRepository(this.db)); }
  private onchainRepo()         { return this.singleton('onchainRepo',    () => new OnchainActivityRepository(this.db)); }

  // ── Queues ───────────────────────────────────────────────────────────────────

  migrationQueue(): ValkyQueue | null {
    if (!config.zg.hasUpload()) return null;
    return this.singleton('migrationQueue', () => new ValkyQueue(this.redis, QUEUES.migration));
  }
  scrapeQueue()     { return this.singleton('scrapeQueue',     () => new ValkyQueue(this.redis, QUEUES.scrape)); }
  referralClickQ()  { return this.singleton('referralClickQ',  () => new ValkyQueue(this.redis, QUEUES.referralClick)); }
  referralVerifyQ() { return this.singleton('referralVerifyQ', () => new ValkyQueue(this.redis, QUEUES.referralVerify)); }

  // ── Services (factory methods) ────────────────────────────────────────────────

  createGameService(): GameService {
    return this.singleton('gameService', () => new GameService(this.gameRepo()));
  }

  createContentService(): ContentService {
    return this.singleton('contentService', () => new ContentService(this.contentRepo()));
  }

  createGameLeaderboardService(): GameLeaderboardService {
    return this.singleton('gameLbService', () => new GameLeaderboardService(this.gameLbConfigRepo()));
  }

  createGlobalLeaderboardService(): GlobalLeaderboardService {
    return this.singleton('globalLbService', () =>
      new GlobalLeaderboardService(
        this.globalLbRepo(),
        this.gameLbConfigRepo(),
        this.createGameLeaderboardService(),
      ),
    );
  }

  createOnchainService(): OnchainActivityService {
    return this.singleton('onchainService', () => new OnchainActivityService(this.onchainRepo()));
  }

  createMomentsService(): MomentsService {
    return this.singleton('momentsService', () =>
      new MomentsService(
        this.momentsRepo(),
        this.likesRepo(),
        this.daEventRepo(),
        this.migrationQueue(),
        this.createOnchainService(),
      ),
    );
  }

  createCommentsService(): CommentsService {
    return this.singleton('commentsService', () =>
      new CommentsService(this.commentsRepo(), this.momentsRepo()),
    );
  }

  createSocialMediaService(): SocialMediaService {
    return this.singleton('socialService', () =>
      new SocialMediaService(this.socialPostRepo(), this.scrapeQueue()),
    );
  }

  createReferralService(): ReferralService {
    return this.singleton('referralService', () =>
      new ReferralService(this.playerRepo(), this.referralClickQ(), this.referralVerifyQ()),
    );
  }

  createMarketplaceService(): MarketplaceService {
    return this.singleton('marketplaceService', () =>
      new MarketplaceService(this.listingRepo(), this.orderRepo()),
    );
  }

  createPlayerService(): PlayerService {
    return this.singleton('playerService', () =>
      new PlayerService(
        this.playerRepo(),
        this.nonceRepo(),
        this.globalLbRepo(),
        this.createGameLeaderboardService(),
        this.agentRepo(),
        (playerId, code, ip) => this.createReferralService().processSignup(playerId, code, ip),
      ),
    );
  }

  createAccessCodeService(): AccessCodeService {
    return this.singleton('accessCodeService', () => new AccessCodeService());
  }

  // Expose repos needed by admin/upload routes
  getListingRepo() { return this.listingRepo(); }
  getLbConfigRepo() { return this.gameLbConfigRepo(); }
  getMomentsRepo() { return this.momentsRepo(); }
  getSocialPostRepo() { return this.socialPostRepo(); }
  getOnchainRepo() { return this.onchainRepo(); }

  // ── Singleton helper ────────────────────────────────────────────────────────

  private singleton<T>(key: string, factory: () => T): T {
    if (!this.cache.has(key)) {
      this.cache.set(key, factory());
    }
    return this.cache.get(key) as T;
  }
}
