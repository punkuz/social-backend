import type { Model } from 'mongoose';
import { MessageReceipt } from '../chat/schemas/message-receipt.schema';
import type { ChatReceiptUpdatedEvent } from './chat-receipt-updated.event';
import { MessageReceiptBatchWriter } from './message-receipt-batch.writer';

describe('MessageReceiptBatchWriter', () => {
  it('combines delivered and seen events into one idempotent upsert', async () => {
    const bulkWrite = jest.fn().mockResolvedValue(undefined);
    const writer = new MessageReceiptBatchWriter({
      bulkWrite,
    } as unknown as Model<MessageReceipt>);

    await writer.write([
      receipt('delivered', '2026-07-20T10:00:00.000Z'),
      receipt('seen', '2026-07-20T10:01:00.000Z'),
    ]);

    const operations = bulkWrite.mock.calls[0][0];
    expect(operations).toHaveLength(1);
    expect(operations[0]).toEqual(
      expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: { messageId: 'a'.repeat(64), userId: 2 },
          upsert: true,
          timestamps: false,
        }),
      }),
    );
    expect(operations[0].updateOne.update.$min).toEqual({
      deliveredAt: new Date('2026-07-20T10:00:00.000Z'),
      seenAt: new Date('2026-07-20T10:01:00.000Z'),
    });
  });

  it('does not call MongoDB for an empty batch', async () => {
    const bulkWrite = jest.fn();
    const writer = new MessageReceiptBatchWriter({
      bulkWrite,
    } as unknown as Model<MessageReceipt>);

    await writer.write([]);
    expect(bulkWrite).not.toHaveBeenCalled();
  });
});

function receipt(
  status: ChatReceiptUpdatedEvent['status'],
  occurredAt: string,
): ChatReceiptUpdatedEvent {
  return {
    eventName: 'chat.receipt.updated',
    eventVersion: 1,
    messageId: 'a'.repeat(64),
    conversationId: 'conversation-1',
    senderId: 1,
    userId: 2,
    status,
    occurredAt,
  };
}
