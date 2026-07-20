import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MessageReceiptDocument = HydratedDocument<MessageReceipt>;

@Schema({
  collection: 'message_receipts',
  timestamps: true,
  versionKey: false,
})
export class MessageReceipt {
  @Prop({ immutable: true, required: true, type: String })
  messageId!: string;

  @Prop({ immutable: true, maxlength: 128, required: true, type: String })
  conversationId!: string;

  @Prop({ immutable: true, min: 1, required: true, type: Number })
  senderId!: number;

  @Prop({ immutable: true, min: 1, required: true, type: Number })
  userId!: number;

  @Prop({ type: Date })
  deliveredAt?: Date;

  @Prop({ type: Date })
  seenAt?: Date;

  createdAt!: Date;

  updatedAt!: Date;
}

export const MessageReceiptSchema =
  SchemaFactory.createForClass(MessageReceipt);

MessageReceiptSchema.index({ messageId: 1, userId: 1 }, { unique: true });
MessageReceiptSchema.index({ conversationId: 1, userId: 1, updatedAt: -1 });
