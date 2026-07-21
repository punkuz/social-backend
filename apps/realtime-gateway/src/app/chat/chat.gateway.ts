import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import type { WsResponse } from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { WsAuthService } from '../auth/ws-auth.service';
import { ConversationAccessService } from '../conversation/conversation-access.service';
import type {
  ChatMessageCreatedEvent,
  MessageAttachment,
} from '../kafka/chat-message.event';
import type { ChatReceiptUpdatedEvent } from '../kafka/chat-receipt.event';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import { PresenceService } from '../presence/presence.service';
import { SocketRateLimiterService } from './socket-rate-limiter.service';
import { InfrastructureHealthService } from '../infrastructure-health.service';
import { RealtimeMetricsService } from '../metrics/realtime-metrics.service';

interface ConnectedResponse {
  connectionId: string;
  serverId: string;
  userId: number;
}

interface SendMessageCommand {
  clientMessageId: string;
  conversationId: string;
  content: string;
  attachments: MessageAttachment[];
}

interface ReceiptCommand {
  messageId: string;
  senderId: number;
  conversationId: string;
  receiptToken: string;
}

interface ChatMessageEvent {
  clientMessageId: string;
  conversationId: string;
  content: string;
  attachments: MessageAttachment[];
  messageId: string;
  senderId: number;
  sentAt: string;
  receiptToken: string;
}

interface MessageStatusEvent {
  messageId: string;
  senderId: number;
  conversationId: string;
  recipientId?: number;
  status: 'sent' | 'delivered' | 'seen';
  occurredAt: string;
}

@WebSocketGateway({ namespace: '/chat' })
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private namespace!: Namespace;

  private readonly serverId: string;
  private readonly receiptSecret: string;
  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly authService: WsAuthService,
    private readonly kafkaProducer: KafkaProducerService,
    private readonly conversationAccess: ConversationAccessService,
    private readonly presence: PresenceService,
    private readonly rateLimiter: SocketRateLimiterService,
    private readonly infrastructureHealth: InfrastructureHealthService,
    private readonly metrics: RealtimeMetricsService,
    config: ConfigService,
  ) {
    this.serverId =
      config.get<string>('INSTANCE_ID') ?? `realtime-${process.pid}`;
    this.receiptSecret =
      config.get<string>('MESSAGE_RECEIPT_SECRET') ??
      config.getOrThrow<string>('JWT_SECRET');
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);

    if (!token) {
      this.rejectConnection(client);
      return;
    }

    try {
      const user = await this.authService.verifyToken(token);
      client.data.user = user;
      await client.join(this.userRoom(user.id));
      this.metrics.connectionOpened();
      const becameOnline = await this.presence.connect(user.id, client.id);
      if (becameOnline) {
        this.emitPresence(user.id, true);
      }
      await this.deliverPendingMessages(user.id);
      client.emit('chat.connected', {
        connectionId: client.id,
        serverId: this.serverId,
        userId: user.id,
      } satisfies ConnectedResponse);
    } catch {
      this.rejectConnection(client);
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    this.rateLimiter.clear(client.id);
    const userId = client.data.user?.id as number | undefined;
    if (!Number.isInteger(userId) || !userId) {
      return;
    }
    this.metrics.connectionClosed();
    if (await this.presence.disconnect(userId, client.id)) {
      this.emitPresence(userId, false);
    }
  }

  @SubscribeMessage('chat.ping')
  async handlePing(
    @ConnectedSocket() client: Socket,
  ): Promise<WsResponse<ConnectedResponse>> {
    const userId = this.authenticatedUserId(client);
    await this.presence.touch(userId, client.id);

    return {
      event: 'chat.pong',
      data: {
        connectionId: client.id,
        serverId: this.serverId,
        userId,
      },
    };
  }

  @SubscribeMessage('presence.subscribe')
  async handlePresenceSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() rawCommand: unknown,
  ): Promise<void> {
    this.authenticatedUserId(client);
    const userIds = this.parsePresenceUserIds(rawCommand);
    await Promise.all(
      userIds.map((userId) => client.join(this.presenceRoom(userId))),
    );
    client.emit('presence.snapshot', {
      statuses: await this.presence.statuses(userIds),
    });
  }

  @SubscribeMessage('chat.send')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() rawCommand: unknown,
  ): Promise<void> {
    const senderId = this.authenticatedUserId(client);
    this.enforceRateLimit(client, 'message');
    const command = this.parseSendMessage(rawCommand);
    if (!(await this.conversationAccess.isMember(command.conversationId, senderId))) {
      throw new WsException({
        code: 'CONVERSATION_FORBIDDEN',
        message: 'You are not a member of this conversation',
      });
    }
    const messageId = this.messageId(senderId, command.clientMessageId);
    const sentAt = new Date().toISOString();

    try {
      await this.kafkaProducer.publishChatMessage({
        eventName: 'chat.message.created',
        eventVersion: 1,
        messageId,
        clientMessageId: command.clientMessageId,
        conversationId: command.conversationId,
        senderId,
        content: command.content,
        attachments: command.attachments,
        createdAt: sentAt,
      } satisfies ChatMessageCreatedEvent);
      this.metrics.accepted('message');
    } catch {
      this.metrics.rejected('message');
      throw new WsException({
        code: 'MESSAGE_NOT_SENT',
        message: 'The message could not be accepted',
      });
    }
  }

  async fanoutChatMessage(event: ChatMessageCreatedEvent): Promise<void> {
    this.metrics.fanout('message');
    const receiptToken = this.createReceiptToken(
      event.messageId,
      event.senderId,
      event.conversationId,
    );
    const message: ChatMessageEvent = {
      clientMessageId: event.clientMessageId,
      content: event.content,
      attachments: event.attachments ?? [],
      messageId: event.messageId,
      conversationId: event.conversationId,
      senderId: event.senderId,
      sentAt: event.createdAt,
      receiptToken,
    };

    this.emitToUser(event.senderId, 'chat.message.sent', {
      messageId: event.messageId,
      senderId: event.senderId,
      conversationId: event.conversationId,
      status: 'sent',
      occurredAt: event.createdAt,
    } satisfies MessageStatusEvent);

    const recipientIds = (
      await this.conversationAccess.getMembers(event.conversationId)
    ).filter((memberId) => memberId !== event.senderId);
    for (const recipientId of recipientIds) {
      this.emitToUser(recipientId, 'chat.message', message);
    }
  }

  fanoutReceipt(event: ChatReceiptUpdatedEvent): void {
    this.metrics.fanout('receipt');
    this.emitToUser(event.senderId, `chat.message.${event.status}`, {
      messageId: event.messageId,
      senderId: event.senderId,
      conversationId: event.conversationId,
      recipientId: event.userId,
      status: event.status,
      occurredAt: event.occurredAt,
    } satisfies MessageStatusEvent);
  }

  @SubscribeMessage('chat.join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() rawCommand: unknown,
  ): Promise<void> {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.parseConversationId(rawCommand);

    if (!(await this.conversationAccess.isMember(conversationId, userId))) {
      throw new WsException({
        code: 'CONVERSATION_FORBIDDEN',
        message: 'You are not a member of this conversation',
      });
    }

    await client.join(this.conversationRoom(conversationId));
    client.emit('chat.joined', { conversationId });
  }

  @SubscribeMessage('chat.typing')
  async handleTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() rawCommand: unknown,
  ): Promise<void> {
    const userId = this.authenticatedUserId(client);
    this.enforceRateLimit(client, 'typing');
    if (!this.isRecord(rawCommand) || typeof rawCommand.isTyping !== 'boolean') {
      throw this.invalidPayload('isTyping must be a boolean');
    }
    const conversationId = this.parseConversationId(rawCommand);
    if (!(await this.conversationAccess.isMember(conversationId, userId))) {
      throw new WsException({
        code: 'CONVERSATION_FORBIDDEN',
        message: 'You are not a member of this conversation',
      });
    }

    client.to(this.conversationRoom(conversationId)).volatile.emit(
      'chat.typing',
      {
        conversationId,
        userId,
        isTyping: rawCommand.isTyping,
        occurredAt: new Date().toISOString(),
      },
    );
  }

  @SubscribeMessage('chat.open')
  async handleOpenConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() rawCommand: unknown,
  ): Promise<void> {
    const userId = this.authenticatedUserId(client);
    const conversationId = this.parseConversationId(rawCommand);
    if (!(await this.conversationAccess.isMember(conversationId, userId))) {
      throw new WsException({
        code: 'CONVERSATION_FORBIDDEN',
        message: 'You are not a member of this conversation',
      });
    }

    client.data.openConversationId = conversationId;
    client.emit('chat.opened', { conversationId });
  }

  @SubscribeMessage('chat.close')
  handleCloseConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() rawCommand: unknown,
  ): void {
    this.authenticatedUserId(client);
    const conversationId = this.parseConversationId(rawCommand);
    if (client.data.openConversationId === conversationId) {
      delete client.data.openConversationId;
    }
    client.emit('chat.closed', { conversationId });
  }

  @SubscribeMessage('chat.delivered')
  async handleDelivered(
    @ConnectedSocket() client: Socket,
    @MessageBody() rawCommand: unknown,
  ): Promise<void> {
    await this.forwardReceipt(client, rawCommand, 'delivered');
  }

  @SubscribeMessage('chat.seen')
  async handleSeen(
    @ConnectedSocket() client: Socket,
    @MessageBody() rawCommand: unknown,
  ): Promise<void> {
    await this.forwardReceipt(client, rawCommand, 'seen');
  }

  emitToUser(userId: number, event: string, payload: unknown): void {
    this.namespace.to(this.userRoom(userId)).emit(event, payload);
  }

  emitToConversation(
    conversationId: string,
    event: string,
    payload: unknown,
    exceptUserId?: number,
  ): void {
    const target = this.namespace.to(this.conversationRoom(conversationId));
    (exceptUserId ? target.except(this.userRoom(exceptUserId)) : target).emit(
      event,
      payload,
    );
  }

  private async forwardReceipt(
    client: Socket,
    rawCommand: unknown,
    status: 'delivered' | 'seen',
  ): Promise<void> {
    const recipientId = this.authenticatedUserId(client);
    this.enforceRateLimit(client, 'receipt');
    const command = this.parseReceipt(rawCommand);

    if (
      status === 'seen' &&
      client.data.openConversationId !== command.conversationId
    ) {
      throw new WsException({
        code: 'CONVERSATION_NOT_OPEN',
        message: 'A message can only be seen from the open conversation',
      });
    }

    if (recipientId === command.senderId) {
      throw new WsException({
        code: 'INVALID_RECEIPT',
        message: 'A sender cannot acknowledge their own message',
      });
    }

    if (
      !(await this.conversationAccess.isMember(
        command.conversationId,
        recipientId,
      ))
    ) {
      throw new WsException({
        code: 'CONVERSATION_FORBIDDEN',
        message: 'You are not a member of this conversation',
      });
    }

    if (
      !this.isValidReceiptToken(
        command.receiptToken,
        command.messageId,
        command.senderId,
        command.conversationId,
      )
    ) {
      throw new WsException({
        code: 'INVALID_RECEIPT',
        message: 'The message receipt is invalid',
      });
    }

    try {
      await this.kafkaProducer.publishChatReceipt({
        eventName: 'chat.receipt.updated',
        eventVersion: 1,
        messageId: command.messageId,
        senderId: command.senderId,
        conversationId: command.conversationId,
        userId: recipientId,
        status,
        occurredAt: new Date().toISOString(),
      });
      this.metrics.accepted('receipt');
    } catch {
      this.metrics.rejected('receipt');
      throw new WsException({
        code: 'RECEIPT_NOT_ACCEPTED',
        message: 'The message receipt could not be accepted',
      });
    }
  }

  private async deliverPendingMessages(userId: number): Promise<void> {
    try {
      const messages = await this.conversationAccess.pendingDeliveries(userId);
      const occurredAt = new Date().toISOString();
      await this.kafkaProducer.publishChatReceipts(
        messages.map((message) => ({
          eventName: 'chat.receipt.updated',
          eventVersion: 1,
          messageId: message.messageId,
          senderId: message.senderId,
          conversationId: message.conversationId,
          userId,
          status: 'delivered',
          occurredAt,
        })),
      );
      messages.forEach(() => this.metrics.accepted('receipt'));
    } catch (error) {
      this.logger.warn(
        `Could not publish pending deliveries for user ${userId}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private authenticatedUserId(client: Socket): number {
    const userId = client.data.user?.id as number | undefined;

    if (!Number.isInteger(userId) || (userId ?? 0) < 1) {
      throw new WsException('Unauthorized');
    }

    return userId as number;
  }

  private parseSendMessage(rawCommand: unknown): SendMessageCommand {
    if (!this.isRecord(rawCommand)) {
      throw this.invalidPayload('Message payload must be an object');
    }

    const { clientMessageId, conversationId, content, attachments } = rawCommand;

    if (
      typeof clientMessageId !== 'string' ||
      clientMessageId.length < 1 ||
      clientMessageId.length > 128
    ) {
      throw this.invalidPayload('clientMessageId must be 1-128 characters');
    }

    if (
      typeof conversationId !== 'string' ||
      conversationId.length < 1 ||
      conversationId.length > 128
    ) {
      throw this.invalidPayload('conversationId must be 1-128 characters');
    }

    if (typeof content !== 'string' || content.length > 4_000) {
      throw this.invalidPayload('content must be at most 4000 characters');
    }

    const parsedAttachments = this.parseAttachments(attachments);
    if (content.trim().length === 0 && parsedAttachments.length === 0) {
      throw this.invalidPayload('A message needs text or an attachment');
    }

    return {
      clientMessageId,
      conversationId,
      content,
      attachments: parsedAttachments,
    };
  }

  private parseAttachments(value: unknown): MessageAttachment[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 5) {
      throw this.invalidPayload('attachments must contain at most 5 items');
    }

    return value.map((attachment) => {
      if (!this.isRecord(attachment)) {
        throw this.invalidPayload('attachment is invalid');
      }
      const { kind, url, name, mimeType, size } = attachment;
      if (
        (kind !== 'photo' && kind !== 'file') ||
        typeof url !== 'string' ||
        !/^\/api\/v1\/chat\/uploads\/(photos|files)\/[a-f0-9-]{36}(?:\.[a-z0-9]{1,10})?$/.test(
          url,
        ) ||
        (kind === 'photo' && !url.includes('/photos/')) ||
        (kind === 'file' && !url.includes('/files/')) ||
        typeof name !== 'string' ||
        name.length < 1 ||
        name.length > 255 ||
        typeof mimeType !== 'string' ||
        mimeType.length < 1 ||
        mimeType.length > 150 ||
        !Number.isInteger(size) ||
        (size as number) < 1 ||
        (size as number) > 20 * 1024 * 1024
      ) {
        throw this.invalidPayload('attachment is invalid');
      }
      return { kind, url, name, mimeType, size } as MessageAttachment;
    });
  }

  private parseReceipt(rawCommand: unknown): ReceiptCommand {
    if (!this.isRecord(rawCommand)) {
      throw this.invalidPayload('Receipt payload must be an object');
    }

    const { messageId, senderId, conversationId, receiptToken } = rawCommand;

    if (typeof messageId !== 'string' || !/^[a-f0-9]{64}$/.test(messageId)) {
      throw this.invalidPayload('messageId is invalid');
    }

    if (!Number.isInteger(senderId) || (senderId as number) < 1) {
      throw this.invalidPayload('senderId must be a positive integer');
    }

    if (
      typeof conversationId !== 'string' ||
      conversationId.length < 1 ||
      conversationId.length > 128
    ) {
      throw this.invalidPayload('conversationId is invalid');
    }

    if (
      typeof receiptToken !== 'string' ||
      !/^[a-f0-9]{64}$/.test(receiptToken)
    ) {
      throw this.invalidPayload('receiptToken is invalid');
    }

    return {
      messageId,
      senderId: senderId as number,
      conversationId,
      receiptToken,
    };
  }

  private messageId(senderId: number, clientMessageId: string): string {
    return createHash('sha256')
      .update(`${senderId}:${clientMessageId}`)
      .digest('hex');
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

  private isValidReceiptToken(
    actualToken: string,
    messageId: string,
    senderId: number,
    conversationId: string,
  ): boolean {
    const expectedToken = this.createReceiptToken(
      messageId,
      senderId,
      conversationId,
    );

    return timingSafeEqual(
      Buffer.from(actualToken, 'hex'),
      Buffer.from(expectedToken, 'hex'),
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private invalidPayload(message: string): WsException {
    return new WsException({ code: 'INVALID_PAYLOAD', message });
  }

  private enforceRateLimit(
    client: Socket,
    bucket: 'message' | 'receipt' | 'typing',
  ): void {
    if (!this.rateLimiter.consume(client.id, bucket)) {
      throw new WsException({
        code: 'RATE_LIMITED',
        message: `Too many ${bucket} events`,
      });
    }
  }

  private parseConversationId(rawCommand: unknown): string {
    if (!this.isRecord(rawCommand)) {
      throw this.invalidPayload('Payload must be an object');
    }
    const { conversationId } = rawCommand;
    if (
      typeof conversationId !== 'string' ||
      conversationId.length < 1 ||
      conversationId.length > 128
    ) {
      throw this.invalidPayload('conversationId is invalid');
    }
    return conversationId;
  }

  private parsePresenceUserIds(rawCommand: unknown): number[] {
    if (!this.isRecord(rawCommand) || !Array.isArray(rawCommand.userIds)) {
      throw this.invalidPayload('userIds must be an array');
    }
    const userIds = [...new Set(rawCommand.userIds)];
    if (
      userIds.length > 100 ||
      userIds.some((userId) => !Number.isInteger(userId) || userId < 1)
    ) {
      throw this.invalidPayload('userIds must contain up to 100 valid IDs');
    }
    return userIds;
  }

  private emitPresence(userId: number, online: boolean): void {
    if (!this.infrastructureHealth.isRedisReady()) {
      return;
    }
    this.namespace.to(this.presenceRoom(userId)).emit('presence.changed', {
      userId,
      online,
      occurredAt: new Date().toISOString(),
    });
  }

  private extractToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    const authorization = client.handshake.headers.authorization;
    const rawToken =
      typeof authToken === 'string'
        ? authToken
        : typeof authorization === 'string'
          ? authorization
          : null;

    if (!rawToken) {
      return null;
    }

    return rawToken.startsWith('Bearer ')
      ? rawToken.slice('Bearer '.length)
      : rawToken;
  }

  private rejectConnection(client: Socket): void {
    client.emit('chat.error', { code: 'UNAUTHORIZED' });
    client.disconnect(true);
  }

  private userRoom(userId: number): string {
    return `user:${userId}`;
  }

  private conversationRoom(conversationId: string): string {
    return `conversation:${conversationId}`;
  }

  private presenceRoom(userId: number): string {
    return `presence:${userId}`;
  }
}
