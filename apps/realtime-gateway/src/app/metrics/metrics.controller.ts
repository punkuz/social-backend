import { Controller, Get, Header } from '@nestjs/common';
import { RealtimeMetricsService } from './realtime-metrics.service';

@Controller()
export class MetricsController {
  constructor(private readonly metrics: RealtimeMetricsService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  render(): Promise<string> {
    return this.metrics.render();
  }
}
