import { Controller, Get, Header } from '@nestjs/common';
import { StorageMetricsService } from './storage-metrics.service';

@Controller()
export class MetricsController {
  constructor(private readonly metrics: StorageMetricsService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  render(): Promise<string> {
    return this.metrics.render();
  }
}
