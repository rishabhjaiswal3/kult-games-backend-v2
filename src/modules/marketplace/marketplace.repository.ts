import { Db, ObjectId } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { ListingModel, OrderModel } from './marketplace.model';

export class ListingRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.listings);
  }

  async findActive(
    gameIdentification: string | undefined,
    category: string | undefined,
    skip: number,
    limit: number,
  ): Promise<{ items: ListingModel[]; totalCount: number }> {
    const filter: Record<string, unknown> = { status: 'active' };
    if (gameIdentification) filter['gameIdentification'] = gameIdentification;
    if (category) filter['category'] = category;

    const [items, totalCount] = await Promise.all([
      this.collection.find<ListingModel>(filter).skip(skip).limit(limit).toArray(),
      this.collection.countDocuments(filter),
    ]);
    return { items, totalCount };
  }

  async findById(id: string): Promise<ListingModel | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.collection.findOne<ListingModel>({ _id: new ObjectId(id) });
  }

  async upsert(listing: ListingModel): Promise<void> {
    await this.collection.replaceOne(
      { gameIdentification: listing.gameIdentification, name: listing.name },
      listing,
      { upsert: true },
    );
  }
}

export class OrderRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.orders);
  }

  async create(order: OrderModel): Promise<OrderModel> {
    const result = await this.collection.insertOne({ ...order, createdAt: new Date() });
    return { ...order, _id: result.insertedId };
  }

  async findById(id: string): Promise<OrderModel | null> {
    if (!ObjectId.isValid(id)) return null;
    return this.collection.findOne<OrderModel>({ _id: new ObjectId(id) });
  }

  async findByOrderId(orderId: string): Promise<OrderModel | null> {
    return this.collection.findOne<OrderModel>({ orderId });
  }

  async completePending(orderId: string, playerId: string, txHash: string): Promise<OrderModel | null> {
    return this.collection.findOneAndUpdate(
      { orderId, playerId, status: 'pending' },
      {
        $set: {
          status: 'completed',
          txHash,
          completedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    ) as Promise<OrderModel | null>;
  }

  async findByPlayer(playerId: string): Promise<OrderModel[]> {
    return this.collection
      .find<OrderModel>({ playerId })
      .sort({ createdAt: -1 })
      .toArray();
  }
}
