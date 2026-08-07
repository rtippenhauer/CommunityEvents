import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { EventCommentEntity } from '../../database/entities/event-comment.entity';
import { EventCommentReplyEntity } from '../../database/entities/event-comment-reply.entity';
import { EventEntity } from '../../database/entities/event.entity';
import { UserEntity, UserRole } from '../../database/entities/user.entity';
import { CreateCommentDto } from './dto/create-comment.dto';

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
    @InjectRepository(EventCommentEntity)
    private readonly commentRepo: Repository<EventCommentEntity>,
    @InjectRepository(EventCommentReplyEntity)
    private readonly replyRepo: Repository<EventCommentReplyEntity>,
    @InjectRepository(EventEntity)
    private readonly eventRepo: Repository<EventEntity>,
  ) {}

  async getComments(eventId: number): Promise<CommentView[]> {
    const comments = await this.commentRepo.find({
      where: { eventId },
      relations: ['member', 'replies', 'replies.member'],
      order: { createdAt: 'ASC' },
    });

    return comments.map((c) => this.toCommentView(c));
  }

  async addComment(eventId: number, user: UserEntity, dto: CreateCommentDto): Promise<CommentView> {
    const event = await this.eventRepo.findOne({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const comment = this.commentRepo.create({ eventId, memberId: user.id, body: dto.body });
    const saved = await this.commentRepo.save(comment);

    const full = await this.commentRepo.findOne({
      where: { id: saved.id },
      relations: ['member', 'replies', 'replies.member'],
    });
    return this.toCommentView(full!);
  }

  // Editing is strictly self-service: unlike delete, moderators cannot edit
  // someone else's comment — rewriting words that stay attributed to their
  // author is worse than removing the comment outright.
  async editComment(commentId: number, user: UserEntity, dto: CreateCommentDto): Promise<CommentView> {
    const comment = await this.commentRepo.findOne({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.deletedAt !== null) throw new NotFoundException('Comment not found');

    if (comment.memberId !== user.id) {
      throw new ForbiddenException('Cannot edit another member\'s comment');
    }

    comment.body = dto.body;
    comment.editedAt = new Date();
    await this.commentRepo.save(comment);

    const full = await this.commentRepo.findOne({
      where: { id: comment.id },
      relations: ['member', 'replies', 'replies.member'],
    });
    return this.toCommentView(full!);
  }

  async deleteComment(commentId: number, user: UserEntity): Promise<void> {
    const comment = await this.commentRepo.findOne({ where: { id: commentId } });
    if (!comment) throw new NotFoundException('Comment not found');

    const isMod = user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR;
    if (comment.memberId !== user.id && !isMod) {
      throw new ForbiddenException('Cannot delete another member\'s comment');
    }

    comment.deletedAt = new Date();
    await this.commentRepo.save(comment);
  }

  async addReply(commentId: number, user: UserEntity, dto: CreateCommentDto): Promise<CommentReplyView> {
    const comment = await this.commentRepo.findOne({ where: { id: commentId, deletedAt: IsNull() } });
    if (!comment) throw new NotFoundException('Comment not found');

    const reply = this.replyRepo.create({ commentId, memberId: user.id, body: dto.body });
    const saved = await this.replyRepo.save(reply);

    const full = await this.replyRepo.findOne({
      where: { id: saved.id },
      relations: ['member'],
    });
    return this.toReplyView(full!);
  }

  async editReply(replyId: number, user: UserEntity, dto: CreateCommentDto): Promise<CommentReplyView> {
    const reply = await this.replyRepo.findOne({ where: { id: replyId } });
    if (!reply) throw new NotFoundException('Reply not found');
    if (reply.deletedAt !== null) throw new NotFoundException('Reply not found');

    if (reply.memberId !== user.id) {
      throw new ForbiddenException('Cannot edit another member\'s reply');
    }

    reply.body = dto.body;
    reply.editedAt = new Date();
    await this.replyRepo.save(reply);

    const full = await this.replyRepo.findOne({
      where: { id: reply.id },
      relations: ['member'],
    });
    return this.toReplyView(full!);
  }

  async deleteReply(replyId: number, user: UserEntity): Promise<void> {
    const reply = await this.replyRepo.findOne({ where: { id: replyId } });
    if (!reply) throw new NotFoundException('Reply not found');

    const isMod = user.role === UserRole.ADMIN || user.role === UserRole.MODERATOR;
    if (reply.memberId !== user.id && !isMod) {
      throw new ForbiddenException('Cannot delete another member\'s reply');
    }

    reply.deletedAt = new Date();
    await this.replyRepo.save(reply);
  }

  private toCommentView(c: EventCommentEntity): CommentView {
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

  private toReplyView(r: EventCommentReplyEntity): CommentReplyView {
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
