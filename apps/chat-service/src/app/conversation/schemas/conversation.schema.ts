import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export enum ConversationType {
  Direct = 'direct',
  Group = 'group',
}

@Schema({ collection: 'conversations', timestamps: true, versionKey: false })
export class Conversation {
  @Prop({ immutable: true, required: true, type: String, unique: true })
  conversationId!: string;

  @Prop({ enum: ConversationType, immutable: true, required: true, type: String })
  type!: ConversationType;

  @Prop({ maxlength: 100, trim: true, type: String })
  name?: string;

  @Prop({ immutable: true, min: 1, required: true, type: Number })
  createdBy!: number;

  @Prop({ immutable: true, sparse: true, type: String, unique: true })
  directKey?: string;

  @Prop({ required: true, type: [Number] })
  memberIds!: number[];

  @Prop({ default: [], type: [Number] })
  hiddenForUserIds!: number[];

  @Prop({ default: {}, of: Date, type: Map })
  deletedAtByUser!: Record<string, Date>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);
ConversationSchema.index({ memberIds: 1, updatedAt: -1 });
