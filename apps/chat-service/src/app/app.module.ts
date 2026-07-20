import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { ChatModule } from './chat/chat.module';
import { MessageStorageModule } from './message-storage/message-storage.module';
import { ConversationModule } from './conversation/conversation.module';
import { HealthController } from './health.controller';
import { MetricsController } from './metrics/metrics.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['apps/chat-service/.env', '.env'],
      isGlobal: true,
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        autoIndex:
          config.get<string>('MONGODB_AUTO_INDEX') === 'true' ||
          config.get<string>('NODE_ENV') !== 'production',
        maxPoolSize: Number(config.get<string>('MONGODB_MAX_POOL_SIZE') ?? 20),
        minPoolSize: Number(config.get<string>('MONGODB_MIN_POOL_SIZE') ?? 2),
        serverSelectionTimeoutMS: 5_000,
      }),
    }),
    ChatModule,
    MessageStorageModule,
    ConversationModule,
  ],
  controllers: [HealthController, MetricsController],
  providers: [],
})
export class AppModule {}
