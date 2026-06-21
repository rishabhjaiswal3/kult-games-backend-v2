import { AppError } from '../../core/error';
import { GlobalLeaderboardRepository } from '../leaderboard/leaderboard.repository';
import { GlobalLeaderboardModel } from '../leaderboard/leaderboard.model';

type KpAction = 'give' | 'minus';

export interface InternalKpBalance {
  walletAddress: string;
  kp: number;
  rank?: number;
  level: number;
  updatedAt?: Date;
}

export interface AdjustKpRequest {
  walletAddress?: string;
  action?: KpAction;
  amount?: number;
}

export interface AdjustKpResponse extends InternalKpBalance {
  action: KpAction;
  amount: number;
  previousKp: number;
}

export class InternalKpService {
  constructor(private readonly globalRepo: GlobalLeaderboardRepository) {}

  async getKp(walletAddress: string): Promise<InternalKpBalance> {
    const wallet = normalizeWallet(walletAddress);
    const entry = await this.globalRepo.getPlayerEntry(wallet);
    return toBalance(wallet, entry);
  }

  async adjustKp(req: AdjustKpRequest): Promise<AdjustKpResponse> {
    const wallet = normalizeWallet(req.walletAddress);
    const action = normalizeAction(req.action);
    const amount = normalizeAmount(req.amount);

    const current = await this.globalRepo.getPlayerEntry(wallet);
    const previousKp = current?.score ?? 0;
    const nextKp = action === 'give'
      ? previousKp + amount
      : Math.max(0, previousKp - amount);
    const now = new Date();

    await this.globalRepo.upsertPlayerEntry({
      walletAddress: wallet,
      score: nextKp,
      rank: current?.rank ?? 0,
      level: calculateLevel(nextKp),
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });

    await this.recalculateRanks();
    const updated = await this.globalRepo.getPlayerEntry(wallet);

    return {
      ...toBalance(wallet, updated),
      action,
      amount,
      previousKp,
    };
  }

  private async recalculateRanks(): Promise<void> {
    const entries = await this.globalRepo.getAllEntries();
    const now = new Date();
    const ranked: GlobalLeaderboardModel[] = entries
      .sort((a, b) => b.score - a.score)
      .map((entry, index) => ({
        ...entry,
        rank: index + 1,
        level: calculateLevel(entry.score),
        updatedAt: entry.updatedAt ?? now,
      }));

    await this.globalRepo.replaceAll(ranked);
  }
}

function normalizeWallet(walletAddress: unknown): string {
  if (typeof walletAddress !== 'string' || !walletAddress.trim()) {
    throw AppError.badRequest('walletAddress is required');
  }
  return walletAddress.trim();
}

function normalizeAction(action: unknown): KpAction {
  if (action === 'give' || action === 'minus') return action;
  throw AppError.badRequest("action must be 'give' or 'minus'");
}

function normalizeAmount(amount: unknown): number {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw AppError.badRequest('amount must be a positive number');
  }
  return value;
}

function toBalance(wallet: string, entry: GlobalLeaderboardModel | null): InternalKpBalance {
  return {
    walletAddress: entry?.walletAddress ?? wallet,
    kp: entry?.score ?? 0,
    rank: entry?.rank || undefined,
    level: entry?.level ?? 1,
    updatedAt: entry?.updatedAt,
  };
}

function calculateLevel(score: number): number {
  if (score >= 100_000) return 100;
  if (score >= 50_000)  return 80;
  if (score >= 10_000)  return 60;
  if (score >= 5_000)   return 40;
  if (score >= 1_000)   return 20;
  return 1;
}
