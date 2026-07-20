import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 128)
  conversationId!: string;

  @IsInt()
  @Min(1)
  senderId!: number;

  @IsUUID()
  clientMessageId!: string;

  @IsString()
  @IsNotEmpty()
  @Length(1, 4_000)
  content!: string;
}
