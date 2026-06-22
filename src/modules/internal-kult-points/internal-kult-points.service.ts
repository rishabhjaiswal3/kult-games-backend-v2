import { AppError } from '../../core/error';
import {
  clampKultPoints,
  DEFAULT_KULT_POINTS,
} from '../kult-points/kult-points.model';
import { KultPointsRepository } from '../kult-points/kult-points.repository';

type KultPointsAction = 'give' | 'minus';

export interface KultPointsBalance {
  walletAddress: string;
  kultPoints: number;
  rank?: number;
  level: number;
  updatedAt?: Date;
}

export interface AdjustKultPointsRequest {
  walletAddress?: string;
  action?: KultPointsAction | 'subtract';
  amount?: number;
}

export interface AdjustKultPointsResponse extends KultPointsBalance {
  action: KultPointsAction;
  amount: number;
  previousKultPoints: number;
}

export class InternalKultPointsService {
  constructor(private readonly kultPointsRepository: KultPointsRepository) {}

  async getKultPoints(walletAddress: string): Promise<KultPointsBalance> {
    const wallet = normalizeWallet(walletAddress);
    const entry = await this.kultPointsRepository.findByWallet(wallet);
    return toBalance(
      wallet,
      entry?.kultPoints ?? DEFAULT_KULT_POINTS,
      entry?.updatedAt,
      this.kultPointsRepository,
    );
  }

  async adjustKultPoints(req: AdjustKultPointsRequest): Promise<AdjustKultPointsResponse> {
    const wallet = normalizeWallet(req.walletAddress);
    const action = normalizeAction(req.action);
    const amount = normalizeAmount(req.amount);

    const previousKultPoints = await this.kultPointsRepository.getBalance(wallet);
    const nextKultPoints = action === 'give'
      ? previousKultPoints + amount
      : clampKultPoints(previousKultPoints - amount);

    const updated = await this.kultPointsRepository.setBalance(wallet, nextKultPoints);

    return {
      ...(await toBalance(
        wallet,
        updated.kultPoints,
        updated.updatedAt,
        this.kultPointsRepository,
      )),
      action,
      amount,
      previousKultPoints,
    };
  }
}

function normalizeWallet(walletAddress: unknown): string {
  if (typeof walletAddress !== 'string' || !walletAddress.trim()) {
    throw AppError.badRequest('walletAddress is required');
  }
  return walletAddress.trim();
}

function normalizeAction(action: unknown): KultPointsAction {
  if (action === 'give') return 'give';
  if (action === 'minus' || action === 'subtract') return 'minus';
  throw AppError.badRequest("action must be 'give', 'minus', or 'subtract'");
}

function normalizeAmount(amount: unknown): number {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw AppError.badRequest('amount must be a positive number');
  }
  return value;
}

async function toBalance(
  wallet: string,
  kultPoints: number,
  updatedAt: Date | undefined,
  kultPointsRepository: KultPointsRepository,
): Promise<KultPointsBalance> {
  const safeKultPoints = clampKultPoints(kultPoints);
  const higherCount = safeKultPoints > 0
    ? await kultPointsRepository.countRankByKultPoints(safeKultPoints)
    : 0;

  return {
    walletAddress: wallet,
    kultPoints: safeKultPoints,
    rank: safeKultPoints > 0 ? higherCount + 1 : undefined,
    level: calculateLevel(safeKultPoints),
    updatedAt,
  };
}

function calculateLevel(kultPoints: number): number {
  if (kultPoints >= 100_000) return 100;
  if (kultPoints >= 50_000)  return 80;
  if (kultPoints >= 10_000)  return 60;
  if (kultPoints >= 5_000)   return 40;
  if (kultPoints >= 1_000)   return 20;
  return 1;
}
