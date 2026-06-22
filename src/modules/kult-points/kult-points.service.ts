import { AppError } from '../../core/error';
import { clampKultPoints, DEFAULT_KULT_POINTS } from './kult-points.model';
import { KultPointsRepository } from './kult-points.repository';

export interface KultPointsBalance {
  walletAddress: string;
  kultPoints: number;
  rank?: number;
  level: number;
  updatedAt?: Date;
}

export class KultPointsService {
  constructor(private readonly kultPointsRepository: KultPointsRepository) {}

  async getKultPoints(walletAddress: string): Promise<KultPointsBalance> {
    const wallet = normalizeWallet(walletAddress);
    const entry = await this.kultPointsRepository.findByWallet(wallet);
    const kultPoints = clampKultPoints(entry?.kultPoints ?? DEFAULT_KULT_POINTS);

    const rank = kultPoints > 0
      ? (await this.kultPointsRepository.countRankByKultPoints(kultPoints)) + 1
      : undefined;

    return {
      walletAddress: wallet,
      kultPoints,
      rank,
      level: calculateLevel(kultPoints),
      updatedAt: entry?.updatedAt,
    };
  }
}

function normalizeWallet(walletAddress: unknown): string {
  if (typeof walletAddress !== 'string' || !walletAddress.trim()) {
    throw AppError.badRequest('walletAddress is required');
  }
  return walletAddress.trim();
}

function calculateLevel(kultPoints: number): number {
  if (kultPoints >= 100_000) return 100;
  if (kultPoints >= 50_000)  return 80;
  if (kultPoints >= 10_000)  return 60;
  if (kultPoints >= 5_000)   return 40;
  if (kultPoints >= 1_000)   return 20;
  return 1;
}
