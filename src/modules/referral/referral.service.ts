import { nanoid } from 'nanoid';
import { AppError } from '../../core/error';
import { logger } from '../../db/logger';
import { ValkyQueue } from '../../db/redis';
import { PlayerRepository } from '../player/player.repository';

export class ReferralService {
  constructor(
    private readonly playerRepo: PlayerRepository,
    private readonly clickQueue: ValkyQueue,
    private readonly verifyQueue: ValkyQueue,
  ) {}

  async getOrCreateCode(wallet: string): Promise<string> {
    const player = await this.playerRepo.findByWallet(wallet);
    if (!player) throw AppError.notFound('Player not found');

    if (player.referralCode) return player.referralCode;

    // Generate a short unique code and persist it
    const code = nanoid(6);
    await this.playerRepo.updateReferralCode(wallet, code);
    logger.info({ wallet, code }, 'Referral code generated');
    return code;
  }

  async trackClick(code: string, ip: string): Promise<void> {
    await this.clickQueue.push({ code, ip, timestamp: Date.now() });
  }

  async processSignup(playerId: string, code: string, ip: string): Promise<void> {
    // Lookup the referrer by code
    const referrer = await this.playerRepo.findByReferralCode(code);
    if (!referrer) {
      logger.warn({ code }, 'Referral code not found during signup');
      return;
    }

    await this.verifyQueue.push({
      referrerId: referrer._id?.toHexString() ?? referrer.walletAddress,
      referredPlayerId: playerId,
      code,
      ip,
      timestamp: Date.now(),
    });
  }
}
