import { Injectable } from '@nestjs/common';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Registry,
} from 'prom-client';

@Injectable()
export class RealtimeMetricsService {
  private readonly registry = new Registry();
  private readonly activeConnections: Gauge;
  private readonly acceptedEvents: Counter;
  private readonly fanoutEvents: Counter;
  private readonly rejectedEvents: Counter;

  constructor() {
    collectDefaultMetrics({
      prefix: 'realtime_gateway_',
      register: this.registry,
    });
    this.activeConnections = new Gauge({
      name: 'realtime_gateway_active_connections',
      help: 'Authenticated Socket.IO connections on this instance',
      registers: [this.registry],
    });
    this.acceptedEvents = new Counter({
      name: 'realtime_gateway_accepted_events_total',
      help: 'Events durably accepted by Kafka',
      labelNames: ['type'],
      registers: [this.registry],
    });
    this.fanoutEvents = new Counter({
      name: 'realtime_gateway_fanout_events_total',
      help: 'Kafka events emitted through the Socket.IO Redis adapter',
      labelNames: ['type'],
      registers: [this.registry],
    });
    this.rejectedEvents = new Counter({
      name: 'realtime_gateway_rejected_events_total',
      help: 'Events rejected before durable acceptance',
      labelNames: ['type'],
      registers: [this.registry],
    });
  }

  connectionOpened(): void {
    this.activeConnections.inc();
  }

  connectionClosed(): void {
    this.activeConnections.dec();
  }

  accepted(type: 'message' | 'receipt'): void {
    this.acceptedEvents.inc({ type });
  }

  fanout(type: 'message' | 'receipt'): void {
    this.fanoutEvents.inc({ type });
  }

  rejected(type: 'message' | 'receipt'): void {
    this.rejectedEvents.inc({ type });
  }

  contentType(): string {
    return this.registry.contentType;
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }
}
