import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { ConversationService } from './conversation.service';
import { CreateConversationDto } from './dto/create-conversation.dto';

interface ActorPayload {
  actorId: number;
}

@Controller()
export class ConversationController {
  constructor(private readonly conversations: ConversationService) {}

  @MessagePattern({ cmd: 'createConversation' })
  create(
    @Payload() payload: ActorPayload & { dto: CreateConversationDto },
  ) {
    return this.conversations.create(payload.actorId, payload.dto);
  }

  @MessagePattern({ cmd: 'listConversations' })
  list(@Payload() payload: ActorPayload) {
    return this.conversations.listForUser(payload.actorId);
  }

  @MessagePattern({ cmd: 'hideConversation' })
  hide(@Payload() payload: ActorPayload & { conversationId: string }) {
    return this.conversations.hideForUser(
      payload.actorId,
      payload.conversationId,
    );
  }

  @MessagePattern({ cmd: 'getConversationMembers' })
  members(@Payload() payload: { conversationId: string }) {
    return this.conversations.getMembers(payload.conversationId);
  }

  @MessagePattern({ cmd: 'listPendingDeliveries' })
  pendingDeliveries(@Payload() payload: ActorPayload) {
    return this.conversations.pendingDeliveries(payload.actorId);
  }

  @MessagePattern({ cmd: 'getConversationHistory' })
  history(
    @Payload()
    payload: ActorPayload & {
      conversationId: string;
      before?: string;
      limit?: number;
    },
  ) {
    return this.conversations.history(
      payload.actorId,
      payload.conversationId,
      payload.before,
      payload.limit,
    );
  }
}
