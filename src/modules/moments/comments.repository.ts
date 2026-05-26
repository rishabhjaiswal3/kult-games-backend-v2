import { ObjectId } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import { CommentModel } from './moments.model';

export class CommentsRepository extends BaseRepository {
  constructor(db: import('mongodb').Db) {
    super(db, config.db.col.momentComments);
  }

  async create(comment: CommentModel): Promise<CommentModel> {
    await this.collection.insertOne(comment as object);
    return comment;
  }

  async findById(commentId: ObjectId): Promise<CommentModel | null> {
    return this.collection.findOne<CommentModel>({ _id: commentId });
  }

  async findTopLevelByMoment(momentId: string, skip: number, limit: number): Promise<CommentModel[]> {
    return this.collection
      .find<CommentModel>({ momentId, parentCommentId: null })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();
  }

  async countTopLevelByMoment(momentId: string): Promise<number> {
    return this.collection.countDocuments({ momentId, parentCommentId: null });
  }

  async findReplies(parentCommentId: ObjectId, skip: number, limit: number): Promise<CommentModel[]> {
    return this.collection
      .find<CommentModel>({ parentCommentId })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .toArray();
  }

  async countReplies(parentCommentId: ObjectId): Promise<number> {
    return this.collection.countDocuments({ parentCommentId });
  }

  async updateContent(commentId: ObjectId, content: string): Promise<CommentModel | null> {
    return this.collection.findOneAndUpdate(
      { _id: commentId },
      { $set: { content, isEdited: true, updatedAt: new Date() } },
      { returnDocument: 'after' },
    ) as unknown as CommentModel | null;
  }

  async softDelete(commentId: ObjectId): Promise<void> {
    const now = new Date();
    await this.collection.updateOne(
      { _id: commentId },
      { $set: { content: '', isDeleted: true, deletedAt: now, updatedAt: now } },
    );
  }

  async hardDelete(commentId: ObjectId): Promise<boolean> {
    const result = await this.collection.deleteOne({ _id: commentId });
    return result.deletedCount > 0;
  }

  async incrementReplyCount(commentId: ObjectId, delta: number): Promise<void> {
    await this.collection.updateOne(
      { _id: commentId },
      { $inc: { replyCount: delta }, $set: { updatedAt: new Date() } },
    );
  }
}
