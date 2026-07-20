import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka } from 'kafkajs';
import type { Consumer } from 'kafkajs';
import { ChatGateway } from '../chat/chat.gateway';
import { parseChatMessageCreatedEvent } from './chat-message.event';
import { parseChatReceiptUpdatedEvent } from './chat-receipt.event';

@Injectable()
export class KafkaFanoutConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(KafkaFanoutConsumer.name);
  private readonly consumer: Consumer;
  private readonly messagesTopic: string;
  private readonly receiptsTopic: string;
  private readonly concurrency: number;
  private ready = false;

  constructor(config: ConfigService, private readonly gateway: ChatGateway) {
    const brokers = config
      .getOrThrow<string>('KAFKA_BROKERS')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    const username = config.get<string>('KAFKA_SASL_USERNAME');
    const password = config.get<string>('KAFKA_SASL_PASSWORD');
    const kafka = new Kafka({
      clientId: config.get<string>('KAFKA_CLIENT_ID') ?? 'realtime-gateway',
      brokers,
      ssl: config.get<string>('KAFKA_SSL') === 'true',
      sasl:
        username && password
          ? { mechanism: 'plain', username, password }
          : undefined,
      connectionTimeout: 10_000,
      requestTimeout: 30_000,
    });

    this.messagesTopic =
      config.get<string>('KAFKA_CHAT_MESSAGES_TOPIC') ?? 'chat.messages.v1';
    this.receiptsTopic =
      config.get<string>('KAFKA_CHAT_RECEIPTS_TOPIC') ?? 'chat.receipts.v1';
    this.concurrency = positiveInteger(
      config.get<string>('KAFKA_FANOUT_CONCURRENCY'),
      3,
    );
    this.consumer = kafka.consumer({
      groupId:
        config.get<string>('KAFKA_FANOUT_GROUP_ID') ?? 'realtime-fanout-v1',
      allowAutoTopicCreation: false,
      heartbeatInterval: 3_000,
      sessionTimeout: 30_000,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({
      topics: [this.messagesTopic, this.receiptsTopic],
      fromBeginning: false,
    });
    await this.consumer.run({
      partitionsConsumedConcurrently: this.concurrency,
      eachMessage: async ({ topic, message }) => {
        try {
          if (topic === this.messagesTopic) {
            await this.gateway.fanoutChatMessage(
              parseChatMessageCreatedEvent(message.value),
            );
          } else if (topic === this.receiptsTopic) {
            this.gateway.fanoutReceipt(
              parseChatReceiptUpdatedEvent(message.value),
            );
          }
        } catch (error) {
          this.logger.error(
            `Skipping invalid fanout event: ${error instanceof Error ? error.message : 'unknown error'}`,
          );
        }
      },
    });
    this.ready = true;
    this.logger.log('Kafka realtime fanout consumer connected');
  }

  async onApplicationShutdown(): Promise<void> {
    this.ready = false;
    await this.consumer.stop();
    await this.consumer.disconnect();
  }

  isReady(): boolean {
    return this.ready;
  }
}

function positiveInteger(rawValue: string | undefined, fallback: number): number {
  const value = Number(rawValue ?? fallback);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error('KAFKA_FANOUT_CONCURRENCY must be a positive integer');
  }

  return value;
}
