import { AppError } from '../../core/error';
import { grantHighwayHustleVehicleReward } from '../../external/highway-hustle-reward';
import { logger } from '../../db/logger';
import { KultPointsRepository } from '../kult-points/kult-points.repository';
import {
  DAILY_REWARD_HIGHWAY_VEHICLE_ID,
  DAILY_REWARD_KP_BY_DAY,
  MS_PER_REWARD_DAY,
  TOTAL_REWARD_DAYS,
  type DailyRewardsDoc,
  type DailyRewardsState,
} from './daily-rewards.model';
import { DailyRewardsRepository } from './daily-rewards.repository';

export interface ClaimDailyRewardRequest {
  legacyDay1?: boolean;
}

export interface ClaimDailyRewardResponse extends DailyRewardsState {
  claimedDay: number;
}

export class DailyRewardsService {
  constructor(
    private readonly dailyRewardsRepository: DailyRewardsRepository,
    private readonly kultPointsRepository: KultPointsRepository,
  ) {}

  async getState(walletAddress: string): Promise<DailyRewardsState> {
    const wallet = normalizeWallet(walletAddress);
    const doc = await this.dailyRewardsRepository.findByWallet(wallet);
    return toState(doc);
  }

  async claim(
    walletAddress: string,
    req: ClaimDailyRewardRequest = {},
  ): Promise<ClaimDailyRewardResponse> {
    const wallet = normalizeWallet(walletAddress);
    const now = new Date();
    let doc = await this.dailyRewardsRepository.findByWallet(wallet);

    if (!doc) {
      if (req.legacyDay1) {
        await this.fulfillReward(wallet, 2);
        doc = await this.dailyRewardsRepository.createRecord({
          walletAddress: wallet,
          claimedDays: [1, 2],
          firstClaimAt: subDays(now, 1),
          lastClaimedAt: now,
        });
        return { ...toState(doc), claimedDay: 2 };
      }

      await this.fulfillReward(wallet, 1);
      doc = await this.dailyRewardsRepository.createRecord({
        walletAddress: wallet,
        claimedDays: [1],
        firstClaimAt: now,
        lastClaimedAt: now,
      });
      return { ...toState(doc), claimedDay: 1 };
    }

    const state = toState(doc);
    if (!state.claimableToday || state.completed) {
      throw AppError.badRequest('No daily reward is available to claim right now');
    }

    const dayToClaim = state.currentDay;
    await this.fulfillReward(wallet, dayToClaim);
    doc = await this.dailyRewardsRepository.appendClaimedDay(wallet, dayToClaim, now);
    return { ...toState(doc), claimedDay: dayToClaim };
  }

  private async fulfillReward(wallet: string, day: number): Promise<void> {
    const kultPoints = DAILY_REWARD_KP_BY_DAY[day];
    if (kultPoints) {
      const previous = await this.kultPointsRepository.getBalance(wallet);
      await this.kultPointsRepository.setBalance(wallet, previous + kultPoints);
      return;
    }

    if (day === 6) {
      try {
        await grantHighwayHustleVehicleReward(
          wallet,
          DAILY_REWARD_HIGHWAY_VEHICLE_ID,
          'Daily login reward — Day 6 Highway Hustle muscle car',
        );
      } catch (err) {
        logger.error({ err, wallet, day }, 'Failed to grant Highway Hustle daily reward');
        throw AppError.internal('Failed to grant Highway Hustle vehicle reward');
      }
      return;
    }

    // Days 1, 2, 4, 5, 7 (arena tokens ignored), 9, 10 — recorded in DB only; UX handled in frontend.
  }
}

function normalizeWallet(walletAddress: unknown): string {
  if (typeof walletAddress !== 'string' || !walletAddress.trim()) {
    throw AppError.badRequest('walletAddress is required');
  }
  return walletAddress.trim().toLowerCase();
}

function subDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * MS_PER_REWARD_DAY);
}

function toState(doc: DailyRewardsDoc | null): DailyRewardsState {
  if (!doc) {
    return {
      currentDay: 1,
      claimedDays: [],
      claimableToday: true,
      nextUnlockAt: null,
      completed: false,
      hasRecord: false,
    };
  }

  const claimedDays = [...doc.claimedDays].sort((a, b) => a - b);
  const highestClaimed = claimedDays.length ? Math.max(...claimedDays) : 0;
  const completed = highestClaimed >= TOTAL_REWARD_DAYS;

  if (completed) {
    return {
      currentDay: TOTAL_REWARD_DAYS,
      claimedDays,
      claimableToday: false,
      nextUnlockAt: null,
      completed: true,
      hasRecord: true,
    };
  }

  const anchorMs = doc.firstClaimAt.getTime();
  const daysSinceAnchor = Math.floor((Date.now() - anchorMs) / MS_PER_REWARD_DAY);
  const maxUnlockableDay = Math.min(TOTAL_REWARD_DAYS, 1 + daysSinceAnchor);
  const claimableToday = highestClaimed < maxUnlockableDay;
  const currentDay = highestClaimed + 1;

  let nextUnlockAt: string | null = null;
  if (!claimableToday) {
    const unlockAt = anchorMs + highestClaimed * MS_PER_REWARD_DAY;
    nextUnlockAt = new Date(unlockAt).toISOString();
  }

  return {
    currentDay,
    claimedDays,
    claimableToday,
    nextUnlockAt,
    completed: false,
    hasRecord: true,
  };
}
