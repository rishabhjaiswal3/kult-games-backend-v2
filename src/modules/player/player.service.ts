import { nanoid } from 'nanoid';
import { AppError } from '../../core/error';
import { signToken, verifySiweSignature, extractNonce } from '../../middleware/auth';
import { logger } from '../../db/logger';
import { PlayerRepository, NonceRepository } from './player.repository';
import {
  LoginRequest, LoginResponse, NonceResponse,
  PlayerProfileResponse, GameScoreEntry,
} from './player.model';

// Imported lazily to avoid circular deps at module init time.
// These types are imported at call sites.
import type { GlobalLeaderboardRepository } from '../leaderboard/leaderboard.repository';
import type { GameLeaderboardService } from '../leaderboard/leaderboard.service';
import type { AgentRepository } from '../agent/agent.repository';

export class PlayerService {
  constructor(
    private readonly playerRepo: PlayerRepository,
    private readonly nonceRepo: NonceRepository,
    private readonly globalLbRepo: GlobalLeaderboardRepository,
    private readonly gameLbService: GameLeaderboardService,
    private readonly agentRepo: AgentRepository,
    private readonly referralQueuePush: ((playerId: string, code: string, ip: string) => Promise<void>) | null,
  ) {}

  async getNonce(wallet: string): Promise<NonceResponse> {
    const nonce = nanoid(16);
    await this.nonceRepo.createNonce(wallet, nonce);
    logger.debug({ wallet }, 'Nonce issued');
    return { nonce };
  }

  async login(req: LoginRequest, ip: string): Promise<LoginResponse> {
    const wallet = req.walletAddress.trim();
    if (!wallet) throw AppError.badRequest('walletAddress is required');

    logger.info({ wallet }, 'Player login attempt');

    // Verify SIWE signature
    try {
      verifySiweSignature(wallet, req.message, req.signature);
    } catch {
      logger.warn({ wallet }, 'SIWE signature verification failed');
      throw AppError.unauthorized('Invalid signature — wallet ownership not proven');
    }

    // Verify nonce was issued by us (consumed on use)
    const nonce = extractNonce(req.message);
    if (!nonce) throw AppError.badRequest('Invalid SIWE message: missing Nonce field');

    const valid = await this.nonceRepo.consumeNonce(wallet, nonce);
    if (!valid) throw AppError.unauthorized('Nonce invalid or expired — request a new nonce and sign again');

    logger.info({ wallet }, 'SIWE verification passed');

    const name = req.name?.trim() || `kult-player_${Date.now().toString(16).slice(-8)}`;
    const metadata = req.metadata as Record<string, unknown> | undefined;

    const { player, isNew } = await this.playerRepo.findOrCreate(wallet, name, metadata);

    if (isNew) {
      logger.info({ wallet, name }, 'New player registered');

      if (req.referralCode && this.referralQueuePush) {
        const playerId = player._id?.toHexString() ?? wallet;
        try {
          await this.referralQueuePush(playerId, req.referralCode, ip);
          logger.info({ wallet, code: req.referralCode }, 'Referral pushed to validation queue');
        } catch (err) {
          logger.error({ err, wallet }, 'Failed to process referral signup');
        }
      }

      try {
        await this.agentRepo.createAgentForNewUser(wallet);
      } catch (err) {
        logger.error({ err, wallet }, 'Failed to generate AI agent for new user');
      }
    }

    const token = signToken(wallet);
    return {
      token,
      player: {
        id: player._id?.toHexString() ?? '',
        walletAddress: player.walletAddress,
        name: player.name,
      },
    };
  }

  async getProfile(wallet: string): Promise<PlayerProfileResponse> {
    const player = await this.playerRepo.findByWallet(wallet);
    if (!player) throw AppError.notFound('Player not found');

    const globalEntry = await this.globalLbRepo.getPlayerEntry(wallet).catch(() => null);
    const { rank, totalScore, level } = globalEntry
      ? { rank: globalEntry.rank, totalScore: globalEntry.score, level: globalEntry.level }
      : { rank: undefined, totalScore: 0, level: 1 };

    const gameScores = await this.gameLbService.fetchScoresForPlayer(wallet).catch(() => [] as [string, number, number, number, number | undefined][]);

    const gameScoresList: GameScoreEntry[] = gameScores.map(
      ([id, score, weight, weightedScore, gameRank]) => ({
        identification: id,
        score,
        weight,
        weightedScore,
        rank: gameRank,
      }),
    );

    const purchasedAssets = player.metadata?.['gameAssets'] ?? undefined;

    return {
      cached: false,
      profile: {
        walletAddress: wallet,
        username: player.name,
        rank,
        totalScore,
        level,
        totalGamesPlayed: gameScoresList.length,
        completedQuests: 0,
        gameScoresList,
        purchasedAssets,
      },
    };
  }

  async updateName(wallet: string, name: string): Promise<{ name: string }> {
    const trimmed = name.trim();
    if (!trimmed) throw AppError.badRequest('Name cannot be empty');
    if (trimmed.length > 100) throw AppError.badRequest('Name cannot exceed 100 characters');

    const updated = await this.playerRepo.updateName(wallet, trimmed);
    if (!updated) throw AppError.notFound('Player not found');

    logger.info({ wallet, name: trimmed }, 'Player name updated');
    return { name: updated.name };
  }
}
