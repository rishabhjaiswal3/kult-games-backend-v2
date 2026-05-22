import { ObjectId } from 'mongodb';

export interface MomentModel {
  _id?: ObjectId;
  momentId: string;
  playerWalletAddress: string;
  assetUrl?: string;
  originalFilename?: string;
  fileSizeBytes?: number;
  assetZgHash?: string;
  metadataZgHash?: string;
  zgStatus?: string;
  assetZgTxHash?: string;
  metadataZgTxHash?: string;
  zgError?: string;
  zgUploadedAt?: Date;
  numLikes: number;
  numComments: number;
  assetMetadata?: Record<string, unknown>;
  title: string;
  description?: string;
  tags: string[];
  relatedGames: string[];
  socialMediaLinks?: Record<string, unknown>;
  aiCaption?: string;
  aiRankScore?: number;
  aiHighlights: string[];
  aiStatus?: string;
  aiMomentType?: string;
  aiSkillScore?: number;
  aiReactionQuality?: string;
  aiRarity?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MomentLikeModel {
  _id?: ObjectId;
  momentId: string;
  authorWalletAddress: string;
  createdAt: Date;
}

export interface DaEventModel {
  _id?: ObjectId;
  momentId: string;
  eventType: string;
  payload?: unknown;
  createdAt: Date;
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateMomentRequest {
  assetUrl?: string;
  assetMetadata?: Record<string, unknown>;
  title: string;
  description?: string;
  tags?: string[];
  relatedGames?: string[];
  socialMediaLinks?: Record<string, unknown>;
}

export interface UpdateMomentRequest {
  title?: string;
  description?: string;
  tags?: string[];
  relatedGames?: string[];
  socialMediaLinks?: Record<string, unknown>;
}

export interface MigrationJob {
  assetUrl: string;
  momentId: string;
  assetType: string;
  attempt: number;
}
