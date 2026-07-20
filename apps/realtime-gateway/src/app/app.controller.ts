import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppService } from './app.service';

@Controller('health')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHealth() {
    return this.appService.getHealth();
  }

  @Get('live')
  getLiveness() {
    return this.appService.getHealth();
  }

  @Get('ready')
  getReadiness() {
    const readiness = this.appService.getReadiness();
    if (!readiness) {
      throw new ServiceUnavailableException('Dependencies are not ready');
    }
    return readiness;
  }
}
