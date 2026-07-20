import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ChatMessageDocument = HydratedDocument<ChatMessage>;

@Schema({
  collection: 'chat_messages',
  timestamps: true,
  versionKey: false,
})
export class ChatMessage {
  @Prop({ immutable: true, required: true, type: String, unique: true })
  messageId!: string;

  @Prop({ immutable: true, maxlength: 128, required: true, type: String })
  conversationId!: string;

  @Prop({ immutable: true, min: 1, required: true, type: Number })
  senderId!: number;

  @Prop({ immutable: true, required: true, type: String })
  clientMessageId!: string;

  @Prop({ maxlength: 4_000, required: true, trim: true, type: String })
  content!: string;

  createdAt!: Date;

  updatedAt!: Date;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

ChatMessageSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true });
ChatMessageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
