import { createHmac, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { RpcException } from '@nestjs/microservices';
import type { Model } from 'mongoose';
import { ChatMessage } from '../chat/schemas/chat-message.schema';
import { MessageReceipt } from '../chat/schemas/message-receipt.schema';
import {
  Conversation,
  ConversationType,
} from './schemas/conversation.schema';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ConversationCacheService } from './conversation-cache.service';

export interface ConversationPreviewMessage {
  messageId: string;
  senderId: number;
  content: string;
  createdAt: Date;
}

interface ConversationUnreadCount {
  _id: string;
  unreadCount: number;
}

interface MessageReceiptSummary {
  _id: string;
  deliveredCount: number;
  seenCount: number;
}

export interface PendingDelivery {
  messageId: string;
  senderId: number;
  conversationId: string;
}

@Injectable()
export class ConversationService {
  private readonly receiptSecret: string;

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
    @InjectModel(ChatMessage.name)
    private readonly messageModel: Model<ChatMessage>,
    @InjectModel(MessageReceipt.name)
    private readonly receiptModel: Model<MessageReceipt>,
    private readonly cache: ConversationCacheService,
    config: ConfigService,
  ) {
    this.receiptSecret =
      config.get<string>('MESSAGE_RECEIPT_SECRET') ??
      config.getOrThrow<string>('JWT_SECRET');
  }

  async create(actorId: number, dto: CreateConversationDto) {
    const memberIds = [...new Set([actorId, ...dto.memberIds])];

    if (dto.type === ConversationType.Direct && memberIds.length !== 2) {
      throw new RpcException({
        code: 'INVALID_DIRECT_CONVERSATION',
        message: 'A direct conversation must contain exactly two users',
        statusCode: 400,
      });
    }

    if (dto.type === ConversationType.Group && memberIds.length < 3) {
      throw new RpcException({
        code: 'INVALID_GROUP_CONVERSATION',
        message: 'A group conversation must contain at least three users',
        statusCode: 400,
      });
    }

    const directKey =
      dto.type === ConversationType.Direct
        ? memberIds.slice().sort((a, b) => a - b).join(':')
        : undefined;

    if (directKey) {
      const existing = await this.conversationModel
        .findOneAndUpdate(
          { directKey },
          { $pull: { hiddenForUserIds: actorId } },
          { new: true },
        )
        .lean()
        .exec();
      if (existing) {
        await this.cache.replaceMembers(existing.conversationId, memberIds);
        return existing;
      }
    }

    const conversation = await this.conversationModel.create({
      conversationId: randomUUID(),
      type: dto.type,
      name: dto.type === ConversationType.Group ? dto.name : undefined,
      createdBy: actorId,
      directKey,
      memberIds,
    });
    await this.cache.replaceMembers(conversation.conversationId, memberIds);
    return conversation.toObject();
  }

  async listForUser(actorId: number) {
    const conversations = await this.conversationModel
      .find({
        hiddenForUserIds: { $ne: actorId },
        memberIds: actorId,
      })
      .sort({ updatedAt: -1 })
      .limit(100)
      .lean()
      .exec();

    if (conversations.length === 0) {
      return [];
    }

    const previews = await this.messageModel
      .aggregate<{
        _id: string;
        lastMessage: ConversationPreviewMessage;
      }>([
        {
          $match: {
            conversationId: {
              $in: conversations.map(({ conversationId }) => conversationId),
            },
          },
        },
        { $sort: { createdAt: -1, _id: -1 } },
        {
          $group: {
            _id: '$conversationId',
            lastMessage: {
              $first: {
                messageId: '$messageId',
                senderId: '$senderId',
                content: '$content',
                createdAt: '$createdAt',
              },
            },
          },
        },
      ])
      .exec();
    const previewsByConversation = new Map(
      previews.map((preview) => [preview._id, preview.lastMessage]),
    );
    const previewReceiptsByMessage = await this.receiptSummaries(
      previews.map((preview) => preview.lastMessage.messageId),
    );

    const unreadFilters = conversations.map((conversation) => {
      const deletedAt = this.deletedAtFor(conversation, actorId);
      return {
        conversationId: conversation.conversationId,
        senderId: { $ne: actorId },
        ...(deletedAt ? { createdAt: { $gt: deletedAt } } : {}),
      };
    });
    const unreadCounts = await this.messageModel
      .aggregate<ConversationUnreadCount>([
        { $match: { $or: unreadFilters } },
        {
          $lookup: {
            from: 'message_receipts',
            let: { currentMessageId: '$messageId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$messageId', '$$currentMessageId'] },
                      { $eq: ['$userId', actorId] },
                      {
                        $ne: [{ $ifNull: ['$seenAt', null] }, null],
                      },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'seenReceipts',
          },
        },
        {
          $match: {
            $expr: { $eq: [{ $size: '$seenReceipts' }, 0] },
          },
        },
        {
          $group: {
            _id: '$conversationId',
            unreadCount: { $sum: 1 },
          },
        },
      ])
      .exec();
    const unreadCountsByConversation = new Map(
      unreadCounts.map((summary) => [summary._id, summary.unreadCount]),
    );

    return conversations
      .map((conversation) => {
        const preview = previewsByConversation.get(conversation.conversationId);
        const deletedAt = this.deletedAtFor(conversation, actorId);
        const previewReceipt = preview
          ? previewReceiptsByMessage.get(preview.messageId)
          : undefined;
        const lastMessage =
          preview && (!deletedAt || preview.createdAt > deletedAt)
            ? {
                ...preview,
                receipts: {
                  deliveredCount: previewReceipt?.deliveredCount ?? 0,
                  seenCount: previewReceipt?.seenCount ?? 0,
                },
              }
            : undefined;
        return {
          ...conversation,
          lastMessage,
          unreadCount:
            unreadCountsByConversation.get(conversation.conversationId) ?? 0,
        };
      })
      .sort((first, second) => {
        const firstActivity =
          first.lastMessage?.createdAt ?? first.updatedAt ?? first.createdAt;
        const secondActivity =
          second.lastMessage?.createdAt ?? second.updatedAt ?? second.createdAt;
        return (
          new Date(secondActivity).getTime() - new Date(firstActivity).getTime()
        );
      });
  }

  async getMembers(conversationId: string): Promise<number[]> {
    const conversation = await this.conversationModel
      .findOne({ conversationId })
      .select({ memberIds: 1 })
      .lean()
      .exec();

    if (!conversation) {
      throw this.notFound();
    }

    await this.cache.replaceMembers(conversationId, conversation.memberIds);
    return conversation.memberIds;
  }

  async pendingDeliveries(actorId: number): Promise<PendingDelivery[]> {
    const conversations = await this.conversationModel
      .find({ memberIds: actorId })
      .select({ conversationId: 1 })
      .lean()
      .exec();
    if (conversations.length === 0) return [];

    return this.messageModel
      .aggregate<PendingDelivery>([
        {
          $match: {
            conversationId: {
              $in: conversations.map(({ conversationId }) => conversationId),
            },
            senderId: { $ne: actorId },
          },
        },
        { $sort: { createdAt: 1, _id: 1 } },
        {
          $lookup: {
            from: 'message_receipts',
            let: { currentMessageId: '$messageId' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$messageId', '$$currentMessageId'] },
                      { $eq: ['$userId', actorId] },
                      {
                        $ne: [{ $ifNull: ['$deliveredAt', null] }, null],
                      },
                    ],
                  },
                },
              },
              { $limit: 1 },
            ],
            as: 'deliveryReceipts',
          },
        },
        {
          $match: {
            $expr: { $eq: [{ $size: '$deliveryReceipts' }, 0] },
          },
        },
        { $limit: 500 },
        {
          $project: {
            _id: 0,
            messageId: 1,
            senderId: 1,
            conversationId: 1,
          },
        },
      ])
      .exec();
  }

  async history(
    actorId: number,
    conversationId: string,
    before?: string,
    limit = 50,
  ) {
    const conversation = await this.conversationModel
      .findOne({ conversationId, memberIds: actorId })
      .select({ deletedAtByUser: 1 })
      .lean()
      .exec();
    if (!conversation) {
      throw this.forbidden();
    }

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const filter: Record<string, unknown> = { conversationId };
    const createdAt: { $gt?: Date; $lt?: Date } = {};
    const deletedAt = this.deletedAtFor(conversation, actorId);
    if (deletedAt) createdAt.$gt = deletedAt;

    if (before) {
      const beforeDate = new Date(before);
      if (Number.isNaN(beforeDate.getTime())) {
        throw new RpcException({
          code: 'INVALID_CURSOR',
          message: 'before must be a valid ISO date',
          statusCode: 400,
        });
      }
      createdAt.$lt = beforeDate;
    }
    if (Object.keys(createdAt).length > 0) filter.createdAt = createdAt;

    const messages = await this.messageModel
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(safeLimit)
      .lean()
      .exec();

    if (messages.length === 0) {
      return [];
    }

    const summariesByMessage = await this.receiptSummaries(
      messages.map((message) => message.messageId),
    );

    return messages.map((message) => {
      const receipt = summariesByMessage.get(message.messageId);
      return {
        ...message,
        receiptToken: this.createReceiptToken(
          message.messageId,
          message.senderId,
          message.conversationId,
        ),
        receipts: {
          deliveredCount: receipt?.deliveredCount ?? 0,
          seenCount: receipt?.seenCount ?? 0,
        },
      };
    });
  }

  private async receiptSummaries(
    messageIds: string[],
  ): Promise<Map<string, MessageReceiptSummary>> {
    if (messageIds.length === 0) return new Map();

    const summaries = await this.receiptModel
      .aggregate<MessageReceiptSummary>([
        {
          $match: {
            messageId: { $in: messageIds },
          },
        },
        {
          $group: {
            _id: '$messageId',
            deliveredCount: {
              $sum: {
                $cond: [
                  {
                    $ne: [
                      { $ifNull: ['$deliveredAt', null] },
                      null,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            seenCount: {
              $sum: {
                $cond: [
                  {
                    $ne: [{ $ifNull: ['$seenAt', null] }, null],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ])
      .exec();
    return new Map(
      summaries.map((summary) => [summary._id, summary]),
    );
  }

  async hideForUser(
    actorId: number,
    conversationId: string,
  ): Promise<{ conversationId: string; deleted: true }> {
    const deletedAt = new Date();
    const result = await this.conversationModel
      .updateOne(
        { conversationId, memberIds: actorId },
        {
          $addToSet: { hiddenForUserIds: actorId },
          $set: { [`deletedAtByUser.${actorId}`]: deletedAt },
        },
      )
      .exec();
    if (result.matchedCount === 0) throw this.forbidden();
    return { conversationId, deleted: true };
  }

  private deletedAtFor(
    conversation: { deletedAtByUser?: unknown },
    actorId: number,
  ): Date | undefined {
    const deletionState = conversation.deletedAtByUser;
    const rawValue =
      deletionState instanceof Map
        ? deletionState.get(String(actorId))
        : typeof deletionState === 'object' && deletionState !== null
          ? (deletionState as Record<string, unknown>)[String(actorId)]
          : undefined;
    if (!rawValue) return undefined;
    const deletedAt = new Date(rawValue as string | number | Date);
    return Number.isNaN(deletedAt.getTime()) ? undefined : deletedAt;
  }

  private createReceiptToken(
    messageId: string,
    senderId: number,
    conversationId: string,
  ): string {
    return createHmac('sha256', this.receiptSecret)
      .update(`${messageId}:${senderId}:${conversationId}`)
      .digest('hex');
  }

  private forbidden(): RpcException {
    return new RpcException({
      code: 'CONVERSATION_FORBIDDEN',
      message: 'You are not a member of this conversation',
      statusCode: 403,
    });
  }

  private notFound(): RpcException {
    return new RpcException({
      code: 'CONVERSATION_NOT_FOUND',
      message: 'Conversation not found',
      statusCode: 404,
    });
  }
}
