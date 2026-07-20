import { Injectable } from '@nestjs/common';

@Injectable()
export class InfrastructureHealthService {
  private redisReady = false;

  setRedisReady(ready: boolean): void {
    this.redisReady = ready;
  }

  isRedisReady(): boolean {
    return this.redisReady;
  }
}
