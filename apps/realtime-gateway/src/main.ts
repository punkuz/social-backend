/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import { RedisIoAdapter } from './app/adapters/redis-io.adapter';
import { InfrastructureHealthService } from './app/infrastructure-health.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const redisIoAdapter = new RedisIoAdapter(
    app,
    config,
    app.get(InfrastructureHealthService),
  );

  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);
  app.enableShutdownHooks();

  const port = Number(config.get<string>('PORT') ?? 3001);
  await app.listen(port);
  Logger.log(`Realtime gateway listening on port ${port}`);
}

bootstrap();
