import { ObjectId } from 'mongodb';

export interface SocialPostModel {
  _id?: ObjectId;
  wallet_address: string;
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
  postUrl: string;
}

export interface ScrapeJob {
  platform: string;
  postUrl: string;
  walletAddress: string;
  postId: string;
}
