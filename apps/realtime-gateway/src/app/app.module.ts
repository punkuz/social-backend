import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ChatGateway } from './chat/chat.gateway';
import { KafkaModule } from './kafka/kafka.module';
import { KafkaFanoutConsumer } from './kafka/kafka-fanout.consumer';
import { ConversationModule } from './conversation/conversation.module';
import { PresenceModule } from './presence/presence.module';
import { InfrastructureHealthService } from './infrastructure-health.service';
import { SocketRateLimiterService } from './chat/socket-rate-limiter.service';
import { MetricsController } from './metrics/metrics.controller';
import { RealtimeMetricsService } from './metrics/realtime-metrics.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: ['apps/realtime-gateway/.env', '.env'],
      isGlobal: true,
    }),
    AuthModule,
    KafkaModule,
    ConversationModule,
    PresenceModule,
  ],
  controllers: [AppController, MetricsController],
  providers: [
    AppService,
    ChatGateway,
    KafkaFanoutConsumer,
    InfrastructureHealthService,
    SocketRateLimiterService,
    RealtimeMetricsService,
  ],
})
export class AppModule {}
