import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createClient,
  createCluster,
  RedisClientType,
  RedisClusterType,
} from 'redis';

type RedisConnection = RedisClientType | RedisClusterType;

@Injectable()
export class PresenceService implements OnModuleInit, OnApplicationShutdown {
  private readonly client: RedisConnection;
  private readonly ttlMilliseconds: number;

  constructor(config: ConfigService) {
    const clusterNodes = config
      .get<string>('REDIS_CLUSTER_NODES')
      ?.split(',')
      .map((node) => node.trim())
      .filter(Boolean);

    this.client = clusterNodes?.length
      ? createCluster({ rootNodes: clusterNodes.map((url) => ({ url })) })
      : createClient({
          url: config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
        });
    this.ttlMilliseconds =
      Number(config.get<string>('PRESENCE_TTL_SECONDS') ?? 90) * 1_000;
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async connect(userId: number, socketId: string): Promise<boolean> {
    const key = this.key(userId);
    await this.removeExpired(key);
    const wasOnline = (await this.client.zCard(key)) > 0;
    await this.client.zAdd(key, {
      score: Date.now() + this.ttlMilliseconds,
      value: socketId,
    });
    await this.client.expire(key, Math.ceil((this.ttlMilliseconds * 2) / 1000));
    return !wasOnline;
  }

  async touch(userId: number, socketId: string): Promise<void> {
    const key = this.key(userId);
    await this.client.zAdd(key, {
      score: Date.now() + this.ttlMilliseconds,
      value: socketId,
    });
    await this.client.expire(key, Math.ceil((this.ttlMilliseconds * 2) / 1000));
  }

  async disconnect(userId: number, socketId: string): Promise<boolean> {
    const key = this.key(userId);
    await this.client.zRem(key, socketId);
    await this.removeExpired(key);
    return (await this.client.zCard(key)) === 0;
  }

  async statuses(userIds: number[]): Promise<Record<number, boolean>> {
    const pairs = await Promise.all(
      userIds.map(async (userId) => {
        const key = this.key(userId);
        await this.removeExpired(key);
        return [userId, (await this.client.zCard(key)) > 0] as const;
      }),
    );
    return Object.fromEntries(pairs);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }

  private removeExpired(key: string): Promise<number> {
    return this.client.zRemRangeByScore(key, 0, Date.now());
  }

  private key(userId: number): string {
    return `chat:presence:${userId}:connections`;
  }
}
