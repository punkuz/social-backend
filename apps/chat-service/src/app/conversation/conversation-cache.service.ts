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
export class ConversationCacheService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly client: RedisConnection;
  private readonly ttlSeconds: number;

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
    this.ttlSeconds = Number(
      config.get<string>('CONVERSATION_CACHE_TTL_SECONDS') ?? 21_600,
    );
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async replaceMembers(
    conversationId: string,
    memberIds: number[],
  ): Promise<void> {
    const key = this.key(conversationId);
    await this.client.del(key);
    await this.client.sAdd(
      key,
      memberIds.map((memberId) => String(memberId)),
    );
    await this.client.expire(key, this.ttlSeconds);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }

  private key(conversationId: string): string {
    return `chat:conversation:${conversationId}:members`;
  }
}
