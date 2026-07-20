import type { Model } from 'mongoose';
import { ChatMessage } from '../chat/schemas/chat-message.schema';
import type { ChatMessageCreatedEvent } from './chat-message-created.event';
import { ChatMessageBatchWriter } from './chat-message-batch.writer';
import { Conversation } from '../conversation/schemas/conversation.schema';

describe('ChatMessageBatchWriter', () => {
  it('uses one unordered idempotent bulk operation per message', async () => {
    const bulkWrite = jest.fn().mockResolvedValue(undefined);
    const updateMany = jest.fn().mockResolvedValue(undefined);
    const writer = new ChatMessageBatchWriter(
      { bulkWrite } as unknown as Model<ChatMessage>,
      { updateMany } as unknown as Model<Conversation>,
    );
    const event = validEvent();

    await writer.write([event, event]);

    expect(bulkWrite).toHaveBeenCalledTimes(1);
    expect(bulkWrite).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          updateOne: expect.objectContaining({
            filter: { messageId: event.messageId },
            upsert: true,
            timestamps: false,
          }),
        }),
      ],
      expect.objectContaining({
        ordered: false,
        timestamps: false,
        writeConcern: { w: 'majority', j: true },
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      { conversationId: { $in: [event.conversationId] } },
      { $set: { hiddenForUserIds: [] } },
    );
  });

  it('does not call MongoDB for an empty batch', async () => {
    const bulkWrite = jest.fn();
    const updateMany = jest.fn();
    const writer = new ChatMessageBatchWriter(
      { bulkWrite } as unknown as Model<ChatMessage>,
      { updateMany } as unknown as Model<Conversation>,
    );

    await writer.write([]);

    expect(bulkWrite).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

function validEvent(): ChatMessageCreatedEvent {
  return {
    eventName: 'chat.message.created',
    eventVersion: 1,
    messageId: 'a'.repeat(64),
    clientMessageId: 'client-message-1',
    conversationId: 'dm:1:2',
    senderId: 1,
    content: 'Hello',
    createdAt: '2026-07-20T10:00:00.000Z',
  };
}
