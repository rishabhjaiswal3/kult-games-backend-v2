import { ObjectId } from 'mongodb';

export const ActivityType = {
  MomentCreated: 'MOMENT_CREATED',
  MomentUpdated: 'MOMENT_UPDATED',
  MomentDeleted: 'MOMENT_DELETED',
  MomentLiked: 'MOMENT_LIKED',
  CommentCreated: 'COMMENT_CREATED',
  CommentDeleted: 'COMMENT_DELETED',
  ReplyCreated: 'REPLY_CREATED',
  SocialPostSubmitted: 'SOCIAL_POST_SUBMITTED',
  SocialPostValidated: 'SOCIAL_POST_VALIDATED',
  AssetMigratedTo0g: 'ASSET_MIGRATED_TO_0G',
} as const;

export type ActivityTypeValue = typeof ActivityType[keyof typeof ActivityType];

export const ACTIVITY_CONTRACT_VALUES: Record<ActivityTypeValue, number> = {
  MOMENT_CREATED: 0,
  MOMENT_UPDATED: 1,
  MOMENT_DELETED: 2,
  MOMENT_LIKED: 3,
  COMMENT_CREATED: 4,
  COMMENT_DELETED: 5,
  REPLY_CREATED: 6,
  SOCIAL_POST_SUBMITTED: 7,
  SOCIAL_POST_VALIDATED: 8,
  ASSET_MIGRATED_TO_0G: 9,
};

export type OnchainActivityStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';

export interface OnchainActivityJob {
  _id?: ObjectId;
  activityId: string;
  userWallet: string;
  activityType: ActivityTypeValue;
  momentId: string;
  entityId: string;
  metadataHash: string;
  status: OnchainActivityStatus;
  txHash?: string;
  attempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}
