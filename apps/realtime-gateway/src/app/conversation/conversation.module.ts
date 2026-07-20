import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { ConversationAccessService } from './conversation-access.service';

@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        inject: [ConfigService],
        name: 'CHAT_SERVICE',
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [
              config.get<string>('RABBITMQ_URL') ??
                'amqp://localhost:5672',
            ],
            queue: config.get<string>('CHAT_QUEUE') ?? 'chat_queue',
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  providers: [ConversationAccessService],
  exports: [ConversationAccessService],
})
export class ConversationModule {}
