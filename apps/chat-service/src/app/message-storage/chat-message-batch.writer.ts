import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AnyBulkWriteOperation, Model } from 'mongoose';
import { ChatMessage } from '../chat/schemas/chat-message.schema';
import type { ChatMessageCreatedEvent } from './chat-message-created.event';
import { Conversation } from '../conversation/schemas/conversation.schema';

@Injectable()
export class ChatMessageBatchWriter {
  constructor(
    @InjectModel(ChatMessage.name)
    private readonly messageModel: Model<ChatMessage>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<Conversation>,
  ) {}

  async write(events: ChatMessageCreatedEvent[]): Promise<void> {
    const uniqueEvents = [
      ...new Map(events.map((event) => [event.messageId, event])).values(),
    ];

    if (uniqueEvents.length === 0) {
      return;
    }

    const operations: AnyBulkWriteOperation<ChatMessage>[] = uniqueEvents.map(
      (event) => {
        const createdAt = new Date(event.createdAt);

        return {
          updateOne: {
            filter: { messageId: event.messageId },
            update: {
              $setOnInsert: {
                messageId: event.messageId,
                clientMessageId: event.clientMessageId,
                conversationId: event.conversationId,
                senderId: event.senderId,
                content: event.content,
                createdAt,
                updatedAt: createdAt,
              },
            },
            upsert: true,
            timestamps: false,
          },
        };
      },
    );

    await this.messageModel.bulkWrite(operations, {
      ordered: false,
      timestamps: false,
      writeConcern: { w: 'majority', j: true },
    });

    await this.conversationModel.updateMany(
      {
        conversationId: {
          $in: [...new Set(uniqueEvents.map((event) => event.conversationId))],
        },
      },
      { $set: { hiddenForUserIds: [] } },
    );
  }
}
