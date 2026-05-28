import { ObjectId } from 'mongodb';

export interface SocialPostModel {
  _id?: ObjectId;
  wallet_address: string;
  moment_id?: string;
  platform: string;
  post_id: string;
  post_url: string;
  raw_data?: unknown;
  scraped_at?: Date;
  validation_status?: string;
  created_at?: Date;
}

export interface SubmitPostRequest {
  platform: string;
  postUrl?: string;
  url?: string;
  momentId?: string;
  postId?: string;
}

export interface ScrapeJob {
  platform: string;
  postUrl: string;
  walletAddress: string;
  postId: string;
  momentId?: string;
  attempt?: number;
}
