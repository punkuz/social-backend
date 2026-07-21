import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class MessageAttachmentDto {
  @IsIn(['photo', 'file'])
  kind!: 'photo' | 'file';

  @IsString()
  @Matches(
    /^\/api\/v1\/chat\/uploads\/(photos|files)\/[a-f0-9-]{36}(?:\.[a-z0-9]{1,10})?$/,
  )
  url!: string;

  @IsString()
  @Length(1, 255)
  name!: string;

  @IsString()
  @Length(1, 150)
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(20 * 1024 * 1024)
  size!: number;
}

export class SendMessageDto {
  @IsString()
  @Length(1, 128)
  conversationId!: string;

  @IsInt()
  @Min(1)
  senderId!: number;

  @IsUUID()
  clientMessageId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  content = '';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments: MessageAttachmentDto[] = [];
}
