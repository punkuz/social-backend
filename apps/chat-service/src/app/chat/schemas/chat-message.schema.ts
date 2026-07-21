import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ChatMessageDocument = HydratedDocument<ChatMessage>;

export interface StoredMessageAttachment {
  kind: 'photo' | 'file';
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

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

  @Prop({ default: '', maxlength: 4_000, trim: true, type: String })
  content!: string;

  @Prop({
    default: [],
    type: [
      {
        _id: false,
        kind: { enum: ['photo', 'file'], required: true, type: String },
        url: { maxlength: 500, required: true, type: String },
        name: { maxlength: 255, required: true, type: String },
        mimeType: { maxlength: 150, required: true, type: String },
        size: { max: 20 * 1024 * 1024, min: 1, required: true, type: Number },
      },
    ],
  })
  attachments!: StoredMessageAttachment[];

  createdAt!: Date;

  updatedAt!: Date;
}

export const ChatMessageSchema = SchemaFactory.createForClass(ChatMessage);

ChatMessageSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true });
ChatMessageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
