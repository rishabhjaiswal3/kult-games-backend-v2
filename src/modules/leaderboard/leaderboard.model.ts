import { ObjectId } from 'mongodb';

export interface GlobalLeaderboardModel {
  _id?: ObjectId;
  walletAddress: string;
  score: number;
  rank: number;
  level: number;
  updatedAt: Date;
  createdAt?: Date;
}

export interface GameLeaderboardConfig {
  _id?: ObjectId;
  identification: string;
  db: string;
  collection: string;
  scoreKey: string;
  personKey: string;
  order: 1 | -1;
  weight: number;
  projection?: string[];
}

export interface LeaderboardEntry {
  rank: number;
  player: string;
  score: number;
  level?: number;
  metadata?: unknown;
}

export interface GlobalLeaderboardEntryDto {
  rank: number;
  walletAddress: string;
  score: number;
  level: number;
}

export interface GlobalLeaderboardResponse {
  entries: GlobalLeaderboardEntryDto[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface GameLeaderboardEntryDto {
  rank: number;
  player: string;
  score: number;
  metadata?: unknown;
}

export interface GameLeaderboardResponse {
  entries: GameLeaderboardEntryDto[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
