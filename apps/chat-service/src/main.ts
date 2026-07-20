/**
 * This is not a production server yet!
 * This is only a minimal backend to get started.
 */

import { Logger, ValidationError, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';
import {
  MicroserviceOptions,
  RpcException,
  Transport,
} from '@nestjs/microservices';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [process.env.RABBITMQ_URL || 'amqp://localhost:5672'],
        queue: process.env.CHAT_QUEUE ?? 'chat_queue',
        queueOptions: {
          durable: true,
        },
      },
    },
    { inheritAppConfig: true },
  );

  app.useGlobalPipes(
    new ValidationPipe({
      exceptionFactory: (errors: ValidationError[]) =>
        new RpcException({
          code: 'VALIDATION_ERROR',
          messages: errors.flatMap((error) =>
            Object.values(error.constraints ?? {}),
          ),
          statusCode: 400,
        }),
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.enableShutdownHooks();
  await app.startAllMicroservices();
  const port = Number(process.env.HEALTH_PORT ?? 3002);
  await app.listen(port);
  Logger.log(`Chat service is running; health endpoint on port ${port}`);
}

bootstrap();
