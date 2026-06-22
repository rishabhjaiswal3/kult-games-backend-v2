import { ObjectId } from 'mongodb';

export const DEFAULT_KULT_POINTS = 0;

export interface KultPointsModel {
  _id?: ObjectId;
  walletAddress: string;
  kultPoints: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export function clampKultPoints(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_KULT_POINTS;
  return Math.max(DEFAULT_KULT_POINTS, value);
}
