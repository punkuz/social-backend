import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AnyBulkWriteOperation, Model } from 'mongoose';
import { MessageReceipt } from '../chat/schemas/message-receipt.schema';
import type { ChatReceiptUpdatedEvent } from './chat-receipt-updated.event';

@Injectable()
export class MessageReceiptBatchWriter {
  constructor(
    @InjectModel(MessageReceipt.name)
    private readonly receiptModel: Model<MessageReceipt>,
  ) {}

  async write(events: ChatReceiptUpdatedEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    const aggregated = new Map<
      string,
      ChatReceiptUpdatedEvent & { deliveredAt: Date; seenAt?: Date }
    >();
    for (const event of events) {
      const key = `${event.messageId}:${event.userId}`;
      const occurredAt = new Date(event.occurredAt);
      const current = aggregated.get(key);
      const deliveredAt = earlier(current?.deliveredAt, occurredAt);
      const seenAt =
        event.status === 'seen'
          ? earlier(current?.seenAt, occurredAt)
          : current?.seenAt;
      aggregated.set(key, { ...event, deliveredAt, seenAt });
    }

    const operations: AnyBulkWriteOperation<MessageReceipt>[] = [
      ...aggregated.values(),
    ].map((event) => {
      const earliestDates = {
        deliveredAt: event.deliveredAt,
        ...(event.seenAt ? { seenAt: event.seenAt } : {}),
      };
      const createdAt = earlier(event.deliveredAt, event.seenAt);

      return {
        updateOne: {
          filter: { messageId: event.messageId, userId: event.userId },
          update: {
            $setOnInsert: {
              messageId: event.messageId,
              conversationId: event.conversationId,
              senderId: event.senderId,
              userId: event.userId,
              createdAt,
            },
            $min: earliestDates,
            $max: { updatedAt: new Date(event.occurredAt) },
          },
          upsert: true,
          timestamps: false,
        },
      };
    });

    await this.receiptModel.bulkWrite(operations, {
      ordered: false,
      timestamps: false,
      writeConcern: { w: 'majority', j: true },
    });
  }
}

function earlier(left: Date | undefined, right: Date | undefined): Date {
  if (!left) return right as Date;
  if (!right) return left;
  return left <= right ? left : right;
}
