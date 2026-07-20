import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { KafkaChatStorageConsumer } from './message-storage/kafka-chat-storage.consumer';

@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongo: Connection,
    private readonly storageConsumer: KafkaChatStorageConsumer,
  ) {}

  @Get('live')
  live() {
    return { service: 'chat-service', status: 'ok' };
  }

  @Get('ready')
  async ready() {
    if (!this.storageConsumer.isReady()) {
      throw new ServiceUnavailableException('Kafka consumer is not ready');
    }

    try {
      await this.mongo.db?.admin().ping();
    } catch {
      throw new ServiceUnavailableException('MongoDB is not ready');
    }

    return { service: 'chat-service', status: 'ready' };
  }
}
