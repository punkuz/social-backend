import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { WsException } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { WsAuthService } from '../auth/ws-auth.service';
import { ConversationAccessService } from '../conversation/conversation-access.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { PresenceService } from '../presence/presence.service';
import { ChatGateway } from './chat.gateway';
import { SocketRateLimiterService } from './socket-rate-limiter.service';
import { InfrastructureHealthService } from '../infrastructure-health.service';
import { RealtimeMetricsService } from '../metrics/realtime-metrics.service';

describe('ChatGateway', () => {
  let gateway: ChatGateway;
  let roomEmit: jest.Mock;
  let toRoom: jest.Mock;
  let publishChatMessage: jest.Mock;
  let publishChatReceipt: jest.Mock;
  let publishChatReceipts: jest.Mock;
  let isMember: jest.Mock;
  let getMembers: jest.Mock;
  let pendingDeliveries: jest.Mock;
  let verifyToken: jest.Mock;

  beforeEach(async () => {
    publishChatMessage = jest.fn().mockResolvedValue(undefined);
    publishChatReceipt = jest.fn().mockResolvedValue(undefined);
    publishChatReceipts = jest.fn().mockResolvedValue(undefined);
    isMember = jest.fn().mockResolvedValue(true);
    getMembers = jest.fn().mockResolvedValue([1, 2]);
    pendingDeliveries = jest.fn().mockResolvedValue([]);
    verifyToken = jest.fn();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatGateway,
        {
          provide: WsAuthService,
          useValue: { verifyToken },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) =>
              key === 'INSTANCE_ID' ? 'test-realtime' : 'receipt-secret',
            ),
            getOrThrow: jest.fn().mockReturnValue('jwt-secret'),
          },
        },
        {
          provide: KafkaProducerService,
          useValue: {
            publishChatMessage,
            publishChatReceipt,
            publishChatReceipts,
          },
        },
        {
          provide: ConversationAccessService,
          useValue: { getMembers, isMember, pendingDeliveries },
        },
        {
          provide: PresenceService,
          useValue: {
            connect: jest.fn().mockResolvedValue(true),
            disconnect: jest.fn().mockResolvedValue(true),
            touch: jest.fn().mockResolvedValue(undefined),
            statuses: jest.fn().mockResolvedValue([]),
          },
        },
        {
          provide: SocketRateLimiterService,
          useValue: {
            consume: jest.fn().mockReturnValue(true),
            clear: jest.fn(),
          },
        },
        {
          provide: InfrastructureHealthService,
          useValue: { isRedisReady: jest.fn().mockReturnValue(true) },
        },
        {
          provide: RealtimeMetricsService,
          useValue: {
            connectionOpened: jest.fn(),
            connectionClosed: jest.fn(),
            accepted: jest.fn(),
            fanout: jest.fn(),
            rejected: jest.fn(),
          },
        },
      ],
    }).compile();

    gateway = module.get<ChatGateway>(ChatGateway);
    roomEmit = jest.fn();
    const operator = {
      emit: roomEmit,
      except: jest.fn().mockReturnThis(),
    };
    toRoom = jest.fn().mockReturnValue(operator);
    Object.defineProperty(gateway, 'namespace', {
      value: { to: toRoom },
    });
  });

  it('is defined', () => {
    expect(gateway).toBeDefined();
  });

  it('marks stored offline messages delivered when their receiver logs in', async () => {
    verifyToken.mockResolvedValue({ id: 2 });
    pendingDeliveries.mockResolvedValue([
      {
        messageId: 'a'.repeat(64),
        senderId: 1,
        conversationId: 'conversation-1',
      },
    ]);
    const client = {
      id: 'socket-2',
      data: {},
      handshake: { auth: { token: 'valid-token' }, headers: {} },
      join: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn(),
      disconnect: jest.fn(),
    } as unknown as Socket;

    await gateway.handleConnection(client);

    expect(pendingDeliveries).toHaveBeenCalledWith(2);
    expect(publishChatReceipts).toHaveBeenCalledWith([
      expect.objectContaining({
        messageId: 'a'.repeat(64),
        senderId: 1,
        conversationId: 'conversation-1',
        userId: 2,
        status: 'delivered',
      }),
    ]);
  });

  it('publishes a message without directly routing it', async () => {
    await gateway.handleSendMessage(authenticatedSocket(1), {
      clientMessageId: 'client-message-1',
      conversationId: 'conversation-1',
      content: 'Hello',
    });

    expect(publishChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'chat.message.created',
        conversationId: 'conversation-1',
        senderId: 1,
      }),
    );
    expect(toRoom).not.toHaveBeenCalled();
  });

  it('fans out a Kafka message and its sent status through user rooms', async () => {
    await gateway.fanoutChatMessage({
      eventName: 'chat.message.created',
      eventVersion: 1,
      messageId: 'a'.repeat(64),
      clientMessageId: 'client-message-1',
      conversationId: 'conversation-1',
      senderId: 1,
      content: 'Hello',
      createdAt: '2026-07-20T10:00:00.000Z',
    });

    expect(toRoom).toHaveBeenNthCalledWith(1, 'user:1');
    expect(roomEmit).toHaveBeenNthCalledWith(
      1,
      'chat.message.sent',
      expect.objectContaining({
        senderId: 1,
        conversationId: 'conversation-1',
        status: 'sent',
      }),
    );
    expect(toRoom).toHaveBeenNthCalledWith(2, 'user:2');
    expect(roomEmit).toHaveBeenNthCalledWith(
      2,
      'chat.message',
      expect.objectContaining({
        clientMessageId: 'client-message-1',
        senderId: 1,
        conversationId: 'conversation-1',
        content: 'Hello',
      }),
    );
  });

  it('publishes valid delivered and seen receipts for durable fanout', async () => {
    await gateway.handleSendMessage(authenticatedSocket(1), {
      clientMessageId: 'client-message-1',
      conversationId: 'conversation-1',
      content: 'Hello',
    });
    await gateway.fanoutChatMessage(publishChatMessage.mock.calls[0][0]);

    const message = roomEmit.mock.calls[1][1] as {
      messageId: string;
      senderId: number;
      receiptToken: string;
      conversationId: string;
    };
    const receipt = {
      messageId: message.messageId,
      senderId: message.senderId,
      conversationId: message.conversationId,
      receiptToken: message.receiptToken,
    };
    const recipient = authenticatedSocket(2);

    await gateway.handleOpenConversation(recipient, {
      conversationId: message.conversationId,
    });
    await gateway.handleDelivered(recipient, receipt);
    await gateway.handleSeen(recipient, receipt);

    expect(publishChatReceipt).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        messageId: message.messageId,
        userId: 2,
        status: 'delivered',
      }),
    );
    expect(publishChatReceipt).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messageId: message.messageId,
        userId: 2,
        status: 'seen',
      }),
    );

    gateway.fanoutReceipt(publishChatReceipt.mock.calls[0][0]);
    gateway.fanoutReceipt(publishChatReceipt.mock.calls[1][0]);

    expect(roomEmit).toHaveBeenNthCalledWith(
      3,
      'chat.message.delivered',
      expect.objectContaining({
        messageId: message.messageId,
        recipientId: 2,
        status: 'delivered',
      }),
    );
    expect(roomEmit).toHaveBeenNthCalledWith(
      4,
      'chat.message.seen',
      expect.objectContaining({
        messageId: message.messageId,
        recipientId: 2,
        status: 'seen',
      }),
    );
  });

  it('rejects seen receipts when the receiver has not opened the conversation', async () => {
    await gateway.handleSendMessage(authenticatedSocket(1), {
      clientMessageId: 'client-message-1',
      conversationId: 'conversation-1',
      content: 'Hello',
    });
    await gateway.fanoutChatMessage(publishChatMessage.mock.calls[0][0]);

    const message = roomEmit.mock.calls[1][1] as {
      messageId: string;
      senderId: number;
      receiptToken: string;
      conversationId: string;
    };

    await expect(
      gateway.handleSeen(authenticatedSocket(2), {
        messageId: message.messageId,
        senderId: message.senderId,
        conversationId: message.conversationId,
        receiptToken: message.receiptToken,
      }),
    ).rejects.toThrow(WsException);
    expect(publishChatReceipt).not.toHaveBeenCalled();
  });

  it('rejects seen receipts after the receiver closes the conversation', async () => {
    await gateway.handleSendMessage(authenticatedSocket(1), {
      clientMessageId: 'client-message-1',
      conversationId: 'conversation-1',
      content: 'Hello',
    });
    await gateway.fanoutChatMessage(publishChatMessage.mock.calls[0][0]);

    const message = roomEmit.mock.calls[1][1] as {
      messageId: string;
      senderId: number;
      receiptToken: string;
      conversationId: string;
    };
    const recipient = authenticatedSocket(2);
    await gateway.handleOpenConversation(recipient, {
      conversationId: message.conversationId,
    });
    gateway.handleCloseConversation(recipient, {
      conversationId: message.conversationId,
    });

    await expect(
      gateway.handleSeen(recipient, {
        messageId: message.messageId,
        senderId: message.senderId,
        conversationId: message.conversationId,
        receiptToken: message.receiptToken,
      }),
    ).rejects.toThrow(WsException);
    expect(publishChatReceipt).not.toHaveBeenCalled();
  });

  it('rejects a receipt from a different user', async () => {
    await gateway.handleSendMessage(authenticatedSocket(1), {
      clientMessageId: 'client-message-1',
      conversationId: 'conversation-1',
      content: 'Hello',
    });
    await gateway.fanoutChatMessage(publishChatMessage.mock.calls[0][0]);

    const message = roomEmit.mock.calls[1][1] as {
      messageId: string;
      senderId: number;
      receiptToken: string;
      conversationId: string;
    };

    isMember.mockResolvedValueOnce(false);
    await expect(
      gateway.handleDelivered(authenticatedSocket(3), {
        messageId: message.messageId,
        senderId: message.senderId,
        conversationId: message.conversationId,
        receiptToken: message.receiptToken,
      }),
    ).rejects.toThrow(WsException);
  });

  it('does not emit a message when Kafka rejects it', async () => {
    publishChatMessage.mockRejectedValueOnce(new Error('Kafka unavailable'));

    await expect(
      gateway.handleSendMessage(authenticatedSocket(1), {
        clientMessageId: 'client-message-1',
        conversationId: 'conversation-1',
        content: 'Hello',
      }),
    ).rejects.toThrow(WsException);
    expect(toRoom).not.toHaveBeenCalled();
  });
});

function authenticatedSocket(userId: number): Socket {
  return {
    data: { user: { id: userId } },
    emit: jest.fn(),
  } as unknown as Socket;
}
