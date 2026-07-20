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

@Controller('chat')
@UseGuards(AuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class ChatController {
  constructor(
    @Inject('CHAT_SERVICE') private readonly chatClient: ClientProxy,
    @Inject('USER_SERVICE') private readonly userClient: ClientProxy,
  ) {}

  @Post('conversations')
  async create(
    @Req() request: AuthRequest,
    @Body() dto: CreateConversationDto,
  ) {
    const actorId = this.actorId(request);
    const memberIds = [...new Set([actorId, ...dto.memberIds])];
    const existingIds = await lastValueFrom(
      this.userClient.send<number[]>(
        { cmd: 'findExistingUserIds' },
        memberIds,
      ),
    );
    const existingIdSet = new Set(existingIds);
    const missingIds = memberIds.filter((id) => !existingIdSet.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestException({
        code: 'INVALID_CONVERSATION_MEMBERS',
        message: 'One or more conversation members do not exist',
        missingIds,
      });
    }

    return lastValueFrom(
      this.chatClient.send(
        { cmd: 'createConversation' },
        { actorId, dto },
      ),
    );
  }

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

  private actorId(request: AuthRequest): number {
    const actorId = request.user?.id;
    if (!Number.isInteger(actorId) || (actorId ?? 0) < 1) {
      throw new UnauthorizedException();
    }
    return actorId as number;
  }
}
