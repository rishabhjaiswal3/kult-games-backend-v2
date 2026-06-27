import { ObjectId } from 'mongodb';

export type TitleType = 'GOLDEN_FOUNDER' | 'VIP_GROWTH_MEMBER';

export const TITLE_TYPES: TitleType[] = ['GOLDEN_FOUNDER', 'VIP_GROWTH_MEMBER'];

export interface TitleGrant {
  type: TitleType;
  grantedAt: Date;
}

export interface PlayerTitleDoc {
  _id?: ObjectId;
  playerWalletAddress: string;
  titles: TitleGrant[];
  createdAt: Date;
  updatedAt: Date;
}
