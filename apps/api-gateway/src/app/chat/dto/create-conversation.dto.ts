import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export enum ConversationType {
  Direct = 'direct',
  Group = 'group',
}

export class CreateConversationDto {
  @IsEnum(ConversationType)
  type!: ConversationType;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1_000)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  memberIds!: number[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
