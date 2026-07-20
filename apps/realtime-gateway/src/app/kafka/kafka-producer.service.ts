import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Partitioners, Producer } from 'kafkajs';
import type { ChatMessageCreatedEvent } from './chat-message.event';
import type { ChatReceiptUpdatedEvent } from './chat-receipt.event';

@Injectable()
export class KafkaProducerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(KafkaProducerService.name);
  private readonly producer: Producer;
  private readonly messagesTopic: string;
  private readonly receiptsTopic: string;
  private ready = false;

  constructor(config: ConfigService) {
    const brokers = config
      .getOrThrow<string>('KAFKA_BROKERS')
      .split(',')
      .map((broker) => broker.trim())
      .filter(Boolean);
    const username = config.get<string>('KAFKA_SASL_USERNAME');
    const password = config.get<string>('KAFKA_SASL_PASSWORD');

    if (brokers.length === 0) {
      throw new Error('KAFKA_BROKERS must contain at least one broker');
    }

    if (Boolean(username) !== Boolean(password)) {
      throw new Error(
        'KAFKA_SASL_USERNAME and KAFKA_SASL_PASSWORD must be set together',
      );
    }

    const kafka = new Kafka({
      clientId:
        config.get<string>('KAFKA_CLIENT_ID') ?? 'realtime-gateway-producer',
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
    this.producer = kafka.producer({
      allowAutoTopicCreation: false,
      createPartitioner: Partitioners.DefaultPartitioner,
      idempotent: true,
      maxInFlightRequests: 5,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.producer.connect();
    this.ready = true;
    this.logger.log('Kafka producer connected');
  }

  async publishChatMessage(event: ChatMessageCreatedEvent): Promise<void> {
    await this.producer.send({
      topic: this.messagesTopic,
      acks: -1,
      messages: [
        {
          key: event.conversationId,
          value: JSON.stringify(event),
          headers: {
            'event-name': event.eventName,
            'event-version': String(event.eventVersion),
          },
        },
      ],
    });
  }

  async publishChatReceipt(event: ChatReceiptUpdatedEvent): Promise<void> {
    await this.publishChatReceipts([event]);
  }

  async publishChatReceipts(events: ChatReceiptUpdatedEvent[]): Promise<void> {
    if (events.length === 0) return;

    await this.producer.send({
      topic: this.receiptsTopic,
      acks: -1,
      messages: events.map((event) => ({
        key: event.conversationId,
        value: JSON.stringify(event),
        headers: {
          'event-name': event.eventName,
          'event-version': String(event.eventVersion),
        },
      })),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    this.ready = false;
    await this.producer.disconnect();
  }

  isReady(): boolean {
    return this.ready;
  }
}
