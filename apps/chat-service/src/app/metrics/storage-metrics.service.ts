import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Counter, Registry } from 'prom-client';

@Injectable()
export class StorageMetricsService {
  private readonly registry = new Registry();
  private readonly storedEvents: Counter;
  private readonly deadLetterEvents: Counter;

  constructor() {
    collectDefaultMetrics({ prefix: 'chat_service_', register: this.registry });
    this.storedEvents = new Counter({
      name: 'chat_service_stored_events_total',
      help: 'Events successfully bulk-written to MongoDB',
      labelNames: ['type'],
      registers: [this.registry],
    });
    this.deadLetterEvents = new Counter({
      name: 'chat_service_dead_letter_events_total',
      help: 'Malformed Kafka events sent to the dead-letter topic',
      registers: [this.registry],
    });
  }

  stored(messages: number, receipts: number): void {
    this.storedEvents.inc({ type: 'message' }, messages);
    this.storedEvents.inc({ type: 'receipt' }, receipts);
  }

  deadLettered(count: number): void {
    this.deadLetterEvents.inc(count);
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
