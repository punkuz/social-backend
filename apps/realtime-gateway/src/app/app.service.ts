import { Injectable, Optional } from '@nestjs/common';
import { InfrastructureHealthService } from './infrastructure-health.service';
import { KafkaFanoutConsumer } from './kafka/kafka-fanout.consumer';
import { KafkaProducerService } from './kafka/kafka-producer.service';

@Injectable()
export class AppService {
  constructor(
    @Optional() private readonly infrastructure?: InfrastructureHealthService,
    @Optional() private readonly producer?: KafkaProducerService,
    @Optional() private readonly fanout?: KafkaFanoutConsumer,
  ) {}

  getHealth(): { service: string; status: string } {
    return { service: 'realtime-gateway', status: 'ok' };
  }

  getReadiness(): { service: string; status: string } | null {
    if (
      !this.infrastructure?.isRedisReady() ||
      !this.producer?.isReady() ||
      !this.fanout?.isReady()
    ) {
      return null;
    }

    return { service: 'realtime-gateway', status: 'ready' };
  }
}
