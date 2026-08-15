import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  event_comment_replies as EventCommentReply,
  event_comments as EventComment,
  users as User,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma/prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { isElevatedRole } from '../../common/utils/roles.util';

// The view mappers read member/replies off the loaded rows, so the include
// shape is named once and reused by every query that feeds them.
const COMMENT_INCLUDE = {
  member: true,
  replies: { include: { member: true } },
} as const;

const REPLY_INCLUDE = { member: true } as const;

type CommentWithRelations = EventComment & {
  member?: User | null;
  replies?: (EventCommentReply & { member?: User | null })[];
};

type ReplyWithRelations = EventCommentReply & { member?: User | null };

export interface CommentReplyView {
  id: number;
  memberId: number;
  memberName: string;
  memberPhoto: string | null;
  body: string | null;
  deleted: boolean;
  editedAt: Date | null;
  createdAt: Date;
}

export interface CommentView {
  id: number;
  memberId: number;
  memberName: string;
  memberPhoto: string | null;
  body: string | null;
  deleted: boolean;
  editedAt: Date | null;
  createdAt: Date;
  replies: CommentReplyView[];
}

@Injectable()
export class EventCommentsService {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  async getComments(eventId: number): Promise<CommentView[]> {
    const comments = await this.prisma.event_comments.findMany({
      where: { eventId },
      include: COMMENT_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });

    return comments.map((c) => this.toCommentView(c));
  }

  async addComment(eventId: number, user: User, dto: CreateCommentDto): Promise<CommentView> {
    const event = await this.prisma.events.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    // create returns the row with its relations included, so the separate
    // re-read the entity version needed is no longer necessary.
    const saved = await this.prisma.event_comments.create({
      data: { eventId, memberId: user.id, body: dto.body },
      include: COMMENT_INCLUDE,
    });
    return this.toCommentView(saved);
  }

  // Editing is strictly self-service: unlike delete, moderators cannot edit
  // someone else's comment — rewriting words that stay attributed to their
  // author is worse than removing the comment outright.
  async editComment(commentId: number, user: User, dto: CreateCommentDto): Promise<CommentView> {
    const comment = await this.prisma.event_comments.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.deletedAt !== null) throw new NotFoundException('Comment not found');

    if (comment.memberId !== user.id) {
      throw new ForbiddenException('Cannot edit another member\'s comment');
    }

    const updated = await this.prisma.event_comments.update({
      where: { id: comment.id },
      data: { body: dto.body, editedAt: new Date() },
      include: COMMENT_INCLUDE,
    });
    return this.toCommentView(updated);
  }

  async deleteComment(commentId: number, user: User): Promise<void> {
    const comment = await this.prisma.event_comments.findUnique({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');

    const isMod = isElevatedRole(user.role);
    if (comment.memberId !== user.id && !isMod) {
      throw new ForbiddenException('Cannot delete another member\'s comment');
    }

    await this.prisma.event_comments.update({
      where: { id: comment.id },
      data: { deletedAt: new Date() },
    });
  }

  async addReply(commentId: number, user: User, dto: CreateCommentDto): Promise<CommentReplyView> {
    // findFirst, not findUnique: the deletedAt IS NULL guard is part of the
    // lookup, and findUnique accepts only the unique key. Losing it would let
    // members reply to a deleted comment.
    const comment = await this.prisma.event_comments.findFirst({
      where: { id: commentId, deletedAt: null },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    const saved = await this.prisma.event_comment_replies.create({
      data: { commentId, memberId: user.id, body: dto.body },
      include: REPLY_INCLUDE,
    });
    return this.toReplyView(saved);
  }

  async editReply(replyId: number, user: User, dto: CreateCommentDto): Promise<CommentReplyView> {
    const reply = await this.prisma.event_comment_replies.findUnique({ where: { id: replyId } });
    if (!reply) throw new NotFoundException('Reply not found');
    if (reply.deletedAt !== null) throw new NotFoundException('Reply not found');

    if (reply.memberId !== user.id) {
      throw new ForbiddenException('Cannot edit another member\'s reply');
    }

    const updated = await this.prisma.event_comment_replies.update({
      where: { id: reply.id },
      data: { body: dto.body, editedAt: new Date() },
      include: REPLY_INCLUDE,
    });
    return this.toReplyView(updated);
  }

  async deleteReply(replyId: number, user: User): Promise<void> {
    const reply = await this.prisma.event_comment_replies.findUnique({ where: { id: replyId } });
    if (!reply) throw new NotFoundException('Reply not found');

    const isMod = isElevatedRole(user.role);
    if (reply.memberId !== user.id && !isMod) {
      throw new ForbiddenException('Cannot delete another member\'s reply');
    }

    await this.prisma.event_comment_replies.update({
      where: { id: reply.id },
      data: { deletedAt: new Date() },
    });
  }

  private toCommentView(c: CommentWithRelations): CommentView {
    const deleted = c.deletedAt !== null;
    return {
      id: c.id,
      memberId: c.memberId,
      memberName: deleted ? 'Deleted' : c.member?.fullName ?? 'Member',
      memberPhoto: deleted ? null : (c.member?.profilePhotoPath ?? null),
      body: deleted ? null : c.body,
      deleted,
      editedAt: deleted ? null : c.editedAt,
      createdAt: c.createdAt,
      replies: (c.replies ?? []).map((r) => this.toReplyView(r)),
    };
  }

  private toReplyView(r: ReplyWithRelations): CommentReplyView {
    const deleted = r.deletedAt !== null;
    return {
      id: r.id,
      memberId: r.memberId,
      memberName: deleted ? 'Deleted' : r.member?.fullName ?? 'Member',
      memberPhoto: deleted ? null : (r.member?.profilePhotoPath ?? null),
      body: deleted ? null : r.body,
      deleted,
      editedAt: deleted ? null : r.editedAt,
      createdAt: r.createdAt,
    };
  }
}
