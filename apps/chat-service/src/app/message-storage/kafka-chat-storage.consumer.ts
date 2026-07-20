import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Partitioners } from 'kafkajs';
import type {
  Consumer,
  EachBatchPayload,
  KafkaMessage,
  Producer,
} from 'kafkajs';
import {
  ChatMessageCreatedEvent,
  parseChatMessageCreatedEvent,
} from './chat-message-created.event';
import {
  ChatReceiptUpdatedEvent,
  parseChatReceiptUpdatedEvent,
} from './chat-receipt-updated.event';
import { ChatMessageBatchWriter } from './chat-message-batch.writer';
import { MessageReceiptBatchWriter } from './message-receipt-batch.writer';
import { StorageMetricsService } from '../metrics/storage-metrics.service';

interface InvalidKafkaMessage {
  message: KafkaMessage;
  reason: string;
}

@Injectable()
export class KafkaChatStorageConsumer
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(KafkaChatStorageConsumer.name);
  private readonly consumer: Consumer;
  private readonly deadLetterProducer: Producer;
  private readonly messagesTopic: string;
  private readonly receiptsTopic: string;
  private readonly deadLetterTopic: string;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private ready = false;

  constructor(
    config: ConfigService,
    private readonly batchWriter: ChatMessageBatchWriter,
    private readonly receiptBatchWriter: MessageReceiptBatchWriter,
    private readonly metrics: StorageMetricsService,
  ) {
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
      clientId: config.get<string>('KAFKA_CLIENT_ID') ?? 'chat-storage',
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
    this.deadLetterTopic =
      config.get<string>('KAFKA_CHAT_MESSAGES_DLQ_TOPIC') ??
      'chat.messages.dlq.v1';
    this.batchSize = positiveInteger(
      config.get<string>('KAFKA_STORAGE_BATCH_SIZE'),
      500,
      'KAFKA_STORAGE_BATCH_SIZE',
    );
    this.concurrency = positiveInteger(
      config.get<string>('KAFKA_STORAGE_CONCURRENCY'),
      3,
      'KAFKA_STORAGE_CONCURRENCY',
    );
    this.consumer = kafka.consumer({
      groupId:
        config.get<string>('KAFKA_STORAGE_GROUP_ID') ?? 'chat-storage-v1',
      allowAutoTopicCreation: false,
      heartbeatInterval: 3_000,
      sessionTimeout: 30_000,
      maxBytesPerPartition: 1_048_576,
      maxBytes: 10_485_760,
      maxWaitTimeInMs: 100,
    });
    this.deadLetterProducer = kafka.producer({
      allowAutoTopicCreation: false,
      createPartitioner: Partitioners.DefaultPartitioner,
      idempotent: true,
      maxInFlightRequests: 5,
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    await Promise.all([
      this.consumer.connect(),
      this.deadLetterProducer.connect(),
    ]);
    await this.consumer.subscribe({
      topics: [this.messagesTopic, this.receiptsTopic],
      fromBeginning: false,
    });
    await this.consumer.run({
      autoCommit: true,
      autoCommitThreshold: this.batchSize,
      eachBatchAutoResolve: false,
      partitionsConsumedConcurrently: this.concurrency,
      eachBatch: (payload) => this.processBatch(payload),
    });
    this.ready = true;
    this.logger.log('Kafka chat storage consumer connected');
  }

  async onApplicationShutdown(): Promise<void> {
    this.ready = false;
    await this.consumer.stop();
    await Promise.all([
      this.consumer.disconnect(),
      this.deadLetterProducer.disconnect(),
    ]);
  }

  isReady(): boolean {
    return this.ready;
  }

  private async processBatch(payload: EachBatchPayload): Promise<void> {
    const { batch, heartbeat, resolveOffset, commitOffsetsIfNecessary } =
      payload;

    for (
      let startIndex = 0;
      startIndex < batch.messages.length;
      startIndex += this.batchSize
    ) {
      if (!payload.isRunning() || payload.isStale()) {
        return;
      }

      const messages = batch.messages.slice(
        startIndex,
        startIndex + this.batchSize,
      );
      const messageEvents: ChatMessageCreatedEvent[] = [];
      const receiptEvents: ChatReceiptUpdatedEvent[] = [];
      const invalidMessages: InvalidKafkaMessage[] = [];

      for (const message of messages) {
        try {
          if (batch.topic === this.messagesTopic) {
            messageEvents.push(parseChatMessageCreatedEvent(message.value));
          } else if (batch.topic === this.receiptsTopic) {
            receiptEvents.push(parseChatReceiptUpdatedEvent(message.value));
          } else {
            throw new Error(`Unsupported topic ${batch.topic}`);
          }
        } catch (error) {
          invalidMessages.push({
            message,
            reason: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }

      await this.publishInvalidMessages(
        invalidMessages,
        batch.topic,
        batch.partition,
      );
      await Promise.all([
        this.batchWriter.write(messageEvents),
        this.receiptBatchWriter.write(receiptEvents),
      ]);
      this.metrics.stored(messageEvents.length, receiptEvents.length);

      for (const message of messages) {
        resolveOffset(message.offset);
      }

      await heartbeat();
      await commitOffsetsIfNecessary();
      this.logger.debug(
        `Stored ${messageEvents.length} messages and ${receiptEvents.length} receipts from ${batch.topic}[${batch.partition}]`,
      );
    }
  }

  private async publishInvalidMessages(
    invalidMessages: InvalidKafkaMessage[],
    sourceTopic: string,
    sourcePartition: number,
  ): Promise<void> {
    if (invalidMessages.length === 0) {
      return;
    }

    await this.deadLetterProducer.send({
      topic: this.deadLetterTopic,
      acks: -1,
      messages: invalidMessages.map(({ message, reason }) => ({
        key: message.key,
        value: message.value,
        headers: {
          'error-reason': reason.slice(0, 500),
          'source-topic': sourceTopic,
          'source-partition': String(sourcePartition),
          'source-offset': message.offset,
        },
      })),
    });

    this.logger.warn(
      `Moved ${invalidMessages.length} invalid messages to ${this.deadLetterTopic}`,
    );
    this.metrics.deadLettered(invalidMessages.length);
  }
}

function positiveInteger(
  rawValue: string | undefined,
  fallback: number,
  variableName: string,
): number {
  const value = Number(rawValue ?? fallback);

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${variableName} must be a positive integer`);
  }

  return value;
}
