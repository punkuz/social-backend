import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { ChatMessage } from '../chat/schemas/chat-message.schema';
import { MessageReceipt } from '../chat/schemas/message-receipt.schema';
import { ConversationCacheService } from './conversation-cache.service';
import { Conversation } from './schemas/conversation.schema';
import { ConversationService } from './conversation.service';

describe('ConversationService', () => {
  let service: ConversationService;
  let conversationModel: { find: jest.Mock; findOne: jest.Mock };
  let messageModel: { aggregate: jest.Mock; find: jest.Mock };
  let receiptModel: { aggregate: jest.Mock };

  beforeEach(async () => {
    conversationModel = { find: jest.fn(), findOne: jest.fn() };
    messageModel = { aggregate: jest.fn(), find: jest.fn() };
    receiptModel = { aggregate: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConversationService,
        {
          provide: getModelToken(Conversation.name),
          useValue: conversationModel,
        },
        { provide: getModelToken(ChatMessage.name), useValue: messageModel },
        { provide: getModelToken(MessageReceipt.name), useValue: receiptModel },
        { provide: ConversationCacheService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue(undefined),
            getOrThrow: jest.fn().mockReturnValue('test-receipt-secret'),
          },
        },
      ],
    }).compile();

    service = module.get<ConversationService>(ConversationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns incoming messages that do not have a delivered receipt', async () => {
    const pending = [
      {
        messageId: 'message-1',
        senderId: 1,
        conversationId: 'conversation-1',
      },
    ];
    conversationModel.find.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { conversationId: 'conversation-1' },
          ]),
        }),
      }),
    });
    messageModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue(pending),
    });

    await expect(service.pendingDeliveries(2)).resolves.toEqual(pending);

    expect(messageModel.aggregate).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          $match: expect.objectContaining({ senderId: { $ne: 2 } }),
        }),
        expect.objectContaining({
          $lookup: expect.objectContaining({ from: 'message_receipts' }),
        }),
      ]),
    );
  });

  it('includes the last message receipt status in the conversation list', async () => {
    conversationModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                conversationId: 'conversation-1',
                memberIds: [1, 2],
                hiddenForUserIds: [],
                createdAt: new Date('2026-07-21T10:00:00.000Z'),
                updatedAt: new Date('2026-07-21T10:01:00.000Z'),
              },
            ]),
          }),
        }),
      }),
    });
    messageModel.aggregate
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue([
          {
            _id: 'conversation-1',
            lastMessage: {
              messageId: 'message-1',
              senderId: 1,
              content: 'Hello',
              createdAt: new Date('2026-07-21T10:02:00.000Z'),
            },
          },
        ]),
      })
      .mockReturnValueOnce({
        exec: jest.fn().mockResolvedValue([]),
      });
    receiptModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        {
          _id: 'message-1',
          deliveredCount: 1,
          seenCount: 1,
        },
      ]),
    });

    const result = await service.listForUser(1);

    expect(result[0].lastMessage).toEqual(
      expect.objectContaining({
        messageId: 'message-1',
        receipts: { deliveredCount: 1, seenCount: 1 },
      }),
    );
  });

  it('does not count a missing seenAt field as a seen receipt in history', async () => {
    conversationModel.findOne.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ deletedAtByUser: {} }),
        }),
      }),
    });
    messageModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([
              {
                messageId: 'message-1',
                senderId: 1,
                conversationId: 'conversation-1',
                content: 'Hello',
              },
            ]),
          }),
        }),
      }),
    });
    receiptModel.aggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });

    await service.history(1, 'conversation-1');

    const pipeline = receiptModel.aggregate.mock.calls[0][0];
    expect(pipeline[1].$group.seenCount).toEqual({
      $sum: {
        $cond: [
          { $ne: [{ $ifNull: ['$seenAt', null] }, null] },
          1,
          0,
        ],
      },
    });
  });
});
