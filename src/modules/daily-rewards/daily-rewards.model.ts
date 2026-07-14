export const TOTAL_REWARD_DAYS = 10;
export const MS_PER_REWARD_DAY = 86_400_000;

/** Kult Points granted on daily reward claim. */
export const DAILY_REWARD_KP_BY_DAY: Partial<Record<number, number>> = {
  3: 1_200,
  8: 3_000,
};

/** Highway Hustle vehicle reward id for day 6. */
export const DAILY_REWARD_HIGHWAY_VEHICLE_ID = 'muscle';

/** $ARENA on-chain grants via arena-chain-service (quest reward). */
export const DAILY_REWARD_ARENA_BY_DAY: Partial<Record<number, number>> = {
  7: 500,
};

export interface DailyRewardsDoc {
  walletAddress: string;
  claimedDays: number[];
  /** Anchor for the daily unlock schedule (UTC ms, start of claim streak). */
  firstClaimAt: Date;
  lastClaimedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface DailyRewardsState {
  currentDay: number;
  claimedDays: number[];
  claimableToday: boolean;
  nextUnlockAt: string | null;
  completed: boolean;
  hasRecord: boolean;
}
