import { ObjectId } from 'mongodb';

export interface PlayerModel {
  _id?: ObjectId;
  walletAddress: string;
  name: string;
  metadata?: Record<string, unknown>;
  referralCode?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface NonceModel {
  _id?: ObjectId;
  walletAddress: string;
  nonce: string;
  createdAt: Date;
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface NonceResponse {
  nonce: string;
}

export interface LoginRequest {
  walletAddress: string;
  message: string;
  signature: string;
  name?: string;
  metadata?: unknown;
  referralCode?: string;
}

export interface LoginResponse {
  token: string;
  player: { id: string; walletAddress: string; name: string };
}

export interface GameScoreEntry {
  identification: string;
  score: number;
  weight: number;
  weightedScore: number;
  rank?: number;
}

export interface PlayerProfile {
  walletAddress: string;
  username: string;
  rank?: number;
  totalScore: number;
  kultPoints: number;
  kultPointsRank?: number;
  level: number;
  totalGamesPlayed: number;
  completedQuests: number;
  gameScoresList: GameScoreEntry[];
  purchasedAssets?: unknown;
}

export interface PlayerProfileResponse {
  cached: boolean;
  profile: PlayerProfile;
}
