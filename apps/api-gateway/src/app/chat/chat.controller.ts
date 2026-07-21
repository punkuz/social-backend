import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { lastValueFrom } from 'rxjs';
import { AuthGuard } from '../guards/auth.guard';
import type { AuthRequest } from '../types/auth.types';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { HistoryQueryDto } from './dto/history-query.dto';

/**
 * REST endpoints used by the frontend to manage conversations and load messages.
 *
 * These methods do not send live chat messages. The frontend sends live
 * messages through the separate realtime-gateway WebSocket connection.
 *
 * AuthGuard checks the JWT before any method below is allowed to run.
 */
@Controller('chat')
@UseGuards(AuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ChatController {
  constructor(
    @Inject('CHAT_SERVICE') private readonly chatClient: ClientProxy,
    @Inject('USER_SERVICE') private readonly userClient: ClientProxy,
  ) {}

  /**
   * Frontend use: called when a user starts a private chat or creates a group.
   *
   * Request:
   * POST /chat/conversations
   * Body example: { "type": "direct", "memberIds": [2] }
   *
   * First, it asks user-service whether every member exists. If they do, it
   * asks chat-service to create the conversation and returns it to the frontend.
   * The frontend then uses the returned conversationId to join the socket room.
   */
  @Post('conversations')
  async create(
    @Req() request: AuthRequest,
    @Body() dto: CreateConversationDto,
  ) {
    // actorId is the logged-in user's ID taken from their JWT.
    const actorId = this.actorId(request);

    // Always include the logged-in user and remove duplicate IDs.
    const memberIds = [...new Set([actorId, ...dto.memberIds])];

    // Ask user-service through RabbitMQ which member IDs really exist.
    const existingIds = await lastValueFrom(
      this.userClient.send<number[]>(
        { cmd: 'findExistingUserIds' },
        memberIds,
      ),
    );
    const existingIdSet = new Set(existingIds);
    const missingIds = memberIds.filter((id) => !existingIdSet.has(id));

    // Do not create a conversation containing invalid users.
    if (missingIds.length > 0) {
      throw new BadRequestException({
        code: 'INVALID_CONVERSATION_MEMBERS',
        message: 'One or more conversation members do not exist',
        missingIds,
      });
    }

    // Ask chat-service through RabbitMQ to create the conversation in MongoDB.
    return lastValueFrom(
      this.chatClient.send(
        { cmd: 'createConversation' },
        { actorId, dto },
      ),
    );
  }

  /**
   * Frontend use: called to show the user's chat inbox/conversation list.
   * Usually used when the chat page opens or when the list is refreshed.
   *
   * Request: GET /chat/conversations
   *
   * chat-service returns the user's conversations, latest message and unread
   * count. Conversations hidden by this user are not returned.
   */
  @Get('conversations')
  list(@Req() request: AuthRequest) {
    const actorId = this.actorId(request);
    return lastValueFrom(
      this.chatClient.send(
        { cmd: 'listConversations' },
        { actorId },
      ),
    );
  }

  /**
   * Frontend use: called when the user removes a conversation from their inbox.
   * For example, from a "Delete chat" button or swipe action.
   *
   * Request: DELETE /chat/conversations/:conversationId
   *
   * This only hides the conversation for the current user. It does not delete
   * the conversation or messages for the other members.
   */
  @Delete('conversations/:conversationId')
  hide(
    @Req() request: AuthRequest,
    @Param('conversationId') conversationId: string,
  ) {
    const actorId = this.actorId(request);
    return lastValueFrom(
      this.chatClient.send(
        { cmd: 'hideConversation' },
        { actorId, conversationId },
      ),
    );
  }

  /**
   * Frontend use: called when a user opens a conversation to load saved
   * messages. It is also called while scrolling upward to load older messages.
   *
   * Request: GET /chat/conversations/:conversationId/messages
   * Query example: ?limit=50&before=2026-07-21T10:00:00.000Z
   *
   * `limit` controls how many messages are returned. `before` loads messages
   * older than that date. chat-service checks that the user is a member first.
   */
  @Get('conversations/:conversationId/messages')
  history(
    @Req() request: AuthRequest,
    @Param('conversationId') conversationId: string,
    @Query() query: HistoryQueryDto,
  ) {
    const actorId = this.actorId(request);
    return lastValueFrom(
      this.chatClient.send(
        { cmd: 'getConversationHistory' },
        {
          actorId,
          conversationId,
          before: query.before,
          limit: query.limit,
        },
      ),
    );
  }

  /**
   * Internal helper only; the frontend never calls this method directly.
   * It reads the logged-in user ID that AuthGuard placed on the request.
   */
  private actorId(request: AuthRequest): number {
    const actorId = request.user?.id;
    if (!Number.isInteger(actorId) || (actorId ?? 0) < 1) {
      throw new UnauthorizedException();
    }
    return actorId as number;
  }
}
