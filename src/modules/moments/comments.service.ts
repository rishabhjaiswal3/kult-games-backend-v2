import { ObjectId } from 'mongodb';
import { AppError } from '../../core/error';
import { CommentsRepository } from './comments.repository';
import { MomentsRepository } from './moments.repository';
import {
  CommentModel,
  CommentResponse,
  CommentListResponse,
  CreateCommentRequest,
  UpdateCommentRequest,
} from './moments.model';

const MAX_COMMENT_LENGTH = 500;

export class CommentsService {
  constructor(
    private readonly commentsRepo: CommentsRepository,
    private readonly momentsRepo: MomentsRepository,
  ) {}

  async createComment(momentId: string, wallet: string, req: CreateCommentRequest): Promise<CommentResponse> {
    await this.ensureMomentExists(momentId);
    const content = validateContent(req.content);
    const now = new Date();

    const comment: CommentModel = {
      _id: new ObjectId(),
      momentId,
      parentCommentId: null,
      authorWalletAddress: wallet.trim(),
      content,
      replyCount: 0,
      isEdited: false,
      isDeleted: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.commentsRepo.create(comment);
    const ok = await this.momentsRepo.incrementNumComments(momentId, 1);
    if (!ok) {
      await this.commentsRepo.hardDelete(created._id!);
      throw AppError.notFound('Moment not found');
    }

    return toResponse(created);
  }

  async listComments(momentId: string, page: number, perPage: number): Promise<CommentListResponse> {
    await this.ensureMomentExists(momentId);
    const { skip, limit, safePage, safePerPage } = paginationParams(page, perPage);
    const [comments, total] = await Promise.all([
      this.commentsRepo.findTopLevelByMoment(momentId, skip, limit),
      this.commentsRepo.countTopLevelByMoment(momentId),
    ]);
    return { comments: comments.map(toResponse), total, page: safePage, perPage: safePerPage };
  }

  async createReply(parentCommentId: string, wallet: string, req: CreateCommentRequest): Promise<CommentResponse> {
    const parentId = parseCommentId(parentCommentId);
    const parent = await this.commentsRepo.findById(parentId);
    if (!parent) throw AppError.notFound('Comment not found');
    if (parent.parentCommentId) throw AppError.badRequest('Replies to replies are not allowed');
    if (parent.isDeleted) throw AppError.badRequest('Cannot reply to a deleted comment');

    const content = validateContent(req.content);
    const now = new Date();

    const reply: CommentModel = {
      _id: new ObjectId(),
      momentId: parent.momentId,
      parentCommentId: parentId,
      authorWalletAddress: wallet.trim(),
      content,
      replyCount: 0,
      isEdited: false,
      isDeleted: false,
      deletedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const created = await this.commentsRepo.create(reply);
    await this.commentsRepo.incrementReplyCount(parentId, 1);
    await this.momentsRepo.incrementNumComments(parent.momentId, 1);

    return toResponse(created);
  }

  async listReplies(parentCommentId: string, page: number, perPage: number): Promise<CommentListResponse> {
    const parentId = parseCommentId(parentCommentId);
    const parent = await this.commentsRepo.findById(parentId);
    if (!parent) throw AppError.notFound('Comment not found');
    if (parent.parentCommentId) throw AppError.badRequest('Replies can only be listed for top-level comments');

    const { skip, limit, safePage, safePerPage } = paginationParams(page, perPage);
    const [replies, total] = await Promise.all([
      this.commentsRepo.findReplies(parentId, skip, limit),
      this.commentsRepo.countReplies(parentId),
    ]);
    return { comments: replies.map(toResponse), total, page: safePage, perPage: safePerPage };
  }

  async updateComment(commentId: string, wallet: string, req: UpdateCommentRequest): Promise<CommentResponse> {
    const id = parseCommentId(commentId);
    const existing = await this.commentsRepo.findById(id);
    if (!existing) throw AppError.notFound('Comment not found');
    if (existing.authorWalletAddress !== wallet.trim()) throw AppError.forbidden('You can only edit your own comments');
    if (existing.isDeleted) throw AppError.badRequest('Cannot edit a deleted comment');

    const content = validateContent(req.content);
    const updated = await this.commentsRepo.updateContent(id, content);
    if (!updated) throw AppError.notFound('Comment not found');
    return toResponse(updated);
  }

  async deleteComment(commentId: string, wallet: string): Promise<void> {
    const id = parseCommentId(commentId);
    const existing = await this.commentsRepo.findById(id);
    if (!existing) throw AppError.notFound('Comment not found');
    if (existing.authorWalletAddress !== wallet.trim()) throw AppError.forbidden('You can only delete your own comments');
    if (existing.isDeleted) throw AppError.badRequest('Comment already deleted');

    if (existing.parentCommentId) {
      await this.commentsRepo.hardDelete(id);
      await this.commentsRepo.incrementReplyCount(existing.parentCommentId, -1);
      await this.momentsRepo.incrementNumComments(existing.momentId, -1);

      const parent = await this.commentsRepo.findById(existing.parentCommentId);
      if (parent?.isDeleted && parent.replyCount === 0) {
        await this.commentsRepo.hardDelete(existing.parentCommentId);
      }
      return;
    }

    if (existing.replyCount > 0) {
      await this.commentsRepo.softDelete(id);
    } else {
      await this.commentsRepo.hardDelete(id);
    }
    await this.momentsRepo.incrementNumComments(existing.momentId, -1);
  }

  private async ensureMomentExists(momentId: string): Promise<void> {
    const moment = await this.momentsRepo.findByMomentId(momentId);
    if (!moment) throw AppError.notFound('Moment not found');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateContent(content: string): string {
  const trimmed = (content ?? '').trim();
  if (!trimmed) throw AppError.badRequest('content is required');
  if (trimmed.length > MAX_COMMENT_LENGTH) {
    throw AppError.badRequest(`content cannot exceed ${MAX_COMMENT_LENGTH} characters`);
  }
  return trimmed;
}

function parseCommentId(raw: string): ObjectId {
  if (!ObjectId.isValid(raw)) throw AppError.badRequest('Invalid comment id');
  return new ObjectId(raw);
}

function paginationParams(page: number, perPage: number) {
  const safePage    = Math.max(1, page || 1);
  const safePerPage = Math.min(50, Math.max(1, perPage || 20));
  return { skip: (safePage - 1) * safePerPage, limit: safePerPage, safePage, safePerPage };
}

function toResponse(c: CommentModel): CommentResponse {
  return {
    commentId:           c._id?.toHexString() ?? '',
    momentId:            c.momentId,
    parentCommentId:     c.parentCommentId?.toHexString(),
    authorWalletAddress: c.authorWalletAddress,
    content:             c.isDeleted ? undefined : c.content,
    replyCount:          c.replyCount,
    isEdited:            c.isEdited,
    isDeleted:           c.isDeleted,
    createdAt:           c.createdAt.toISOString(),
    updatedAt:           c.updatedAt.toISOString(),
    deletedAt:           c.deletedAt?.toISOString(),
  };
}
