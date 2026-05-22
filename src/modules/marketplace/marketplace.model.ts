import { ObjectId } from 'mongodb';

export interface ListingModel {
  _id?: ObjectId;
  name: string;
  shortDescription?: string;
  longDescription?: string;
  assetUrl?: string;
  price: number;
  category: string;
  currency: string;
  gameIdentification: string;
  contractItemId?: string;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface OrderModel {
  _id?: ObjectId;
  listingId: ObjectId;
  orderId: string;
  playerId: string;
  buyerWallet: string;
  gameIdentification: string;
  paymentToken: string;
  pricePaid: number;
  quantity: number;
  status: string;
  txHash?: string;
  createdAt?: Date;
}
