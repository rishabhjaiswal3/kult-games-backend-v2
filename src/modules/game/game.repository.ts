import { Db, Document } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { GameModel } from './game.model';
import { getMongoClient } from '../../db/mongo';

export class GameRepository extends BaseRepository {
  constructor(private readonly db: Db) {
    super(db, config.db.col.games);
  }

  private releasedFilter() {
    return { $or: [{ isReleased: true }, { is_released: true }] };
  }

  async findAllPaginated(
    search: string | undefined,
    skip: number,
    limit: number,
  ): Promise<{ games: GameModel[]; totalCount: number }> {
    const filter: Document = this.releasedFilter();

    if (search) {
      const re = new RegExp(search, 'i');
      (filter as Document)['$and'] = [
        this.releasedFilter(),
        { $or: [{ identification: re }, { 'name.en': re }, { category: re }] },
      ];
      delete (filter as Document)['$or'];
    }

    const [games, totalCount] = await Promise.all([
      this.collection.find<GameModel>(filter).skip(skip).limit(limit).toArray(),
      this.collection.countDocuments(filter),
    ]);

    return { games, totalCount };
  }

  async findByIdentification(id: string): Promise<GameModel | null> {
    return this.collection.findOne<GameModel>({ ...this.releasedFilter(), identification: id });
  }

  async getDistinctCategories(): Promise<string[]> {
    const results = await this.collection
      .distinct('category', { ...this.releasedFilter(), category: { $exists: true, $ne: null } });
    return results.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
  }

  async getPlayCount(dbName: string, collectionName: string): Promise<number> {
    const client = getMongoClient();
    const targetDb = client.db(dbName);
    return targetDb.collection(collectionName).countDocuments({});
  }

  async getVectorFacts(gameId: string, limit: number): Promise<string[]> {
    const coll = this.db.collection<Document>('vector_facts');
    const docs = await coll
      .find({ 'metadata.game_id': gameId, 'metadata.category': 'developer_knowledge' })
      .sort({ _id: 1 })
      .limit(limit)
      .toArray();

    return docs
      .map((d) => String(d['text'] ?? '').trim())
      .filter((t) => t.length > 0);
  }
}
