import { Db, Document, ObjectId } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';

export interface ContentConfig {
  _id: ObjectId;
  page: string;
  section: string;
  content_type: string;
  content_order: string[];
  field_mappings?: Array<{ response_key: string; db_path: string }>;
}

export class ContentRepository extends BaseRepository {
  private readonly gameCollection = this.collection.db.collection<Document>(config.db.col.games);

  constructor(db: Db) {
    super(db, config.db.col.content);
  }

  async findByPageSection(page: string, section: string): Promise<ContentConfig | null> {
    return this.collection.findOne<ContentConfig>({ page, section });
  }

  async findGamesByIdentifications(ids: string[]): Promise<Document[]> {
    return this.gameCollection
      .find({ identification: { $in: ids }, $or: [{ isReleased: true }, { is_released: true }] })
      .toArray();
  }
}
