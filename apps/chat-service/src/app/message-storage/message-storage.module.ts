import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  ChatMessage,
  ChatMessageSchema,
} from '../chat/schemas/chat-message.schema';
import {
  MessageReceipt,
  MessageReceiptSchema,
} from '../chat/schemas/message-receipt.schema';
import { ChatMessageBatchWriter } from './chat-message-batch.writer';
import { KafkaChatStorageConsumer } from './kafka-chat-storage.consumer';
import { MessageReceiptBatchWriter } from './message-receipt-batch.writer';
import { StorageMetricsService } from '../metrics/storage-metrics.service';
import {
  Conversation,
  ConversationSchema,
} from '../conversation/schemas/conversation.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: MessageReceipt.name, schema: MessageReceiptSchema },
      { name: Conversation.name, schema: ConversationSchema },
    ]),
  ],
  providers: [
    ChatMessageBatchWriter,
    MessageReceiptBatchWriter,
    KafkaChatStorageConsumer,
    StorageMetricsService,
  ],
  exports: [KafkaChatStorageConsumer, StorageMetricsService],
})
export class MessageStorageModule {}
