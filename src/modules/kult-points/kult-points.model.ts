import { ObjectId } from 'mongodb';

export const DEFAULT_KULT_POINTS = 0;

/** Per-wallet Kult Points balance. New wallets default to kultPoints = 0 when created. */
export interface KultPointsModel {
  _id?: ObjectId;
  walletAddress: string;
  kultPoints: number;
  createdAt: Date;
  updatedAt: Date;
}

export function createDefaultKultPoints(walletAddress: string, now = new Date()): KultPointsModel {
  return {
    walletAddress,
    kultPoints: DEFAULT_KULT_POINTS,
    createdAt: now,
    updatedAt: now,
  };
}

export function clampKultPoints(kultPoints: number): number {
  if (!Number.isFinite(kultPoints)) return DEFAULT_KULT_POINTS;
  return Math.max(DEFAULT_KULT_POINTS, kultPoints);
}
