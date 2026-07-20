import {
  Injectable,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientProxy } from '@nestjs/microservices';
import { Inject } from '@nestjs/common';
import {
  createClient,
  createCluster,
  RedisClientType,
  RedisClusterType,
} from 'redis';
import { lastValueFrom, timeout } from 'rxjs';

type RedisConnection = RedisClientType | RedisClusterType;

export interface PendingDelivery {
  messageId: string;
  senderId: number;
  conversationId: string;
}

@Injectable()
export class ConversationAccessService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly client: RedisConnection;
  private readonly ttlSeconds: number;

  constructor(
    config: ConfigService,
    @Inject('CHAT_SERVICE') private readonly chatClient: ClientProxy,
  ) {
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

  async isMember(conversationId: string, userId: number): Promise<boolean> {
    const members = await this.getMembers(conversationId);
    return members.includes(userId);
  }

  async getMembers(conversationId: string): Promise<number[]> {
    const key = this.key(conversationId);
    if ((await this.client.exists(key)) === 1) {
      return (await this.client.sMembers(key)).map(Number);
    }

    const members = await lastValueFrom(
      this.chatClient
        .send<number[]>(
          { cmd: 'getConversationMembers' },
          { conversationId },
        )
        .pipe(timeout(3_000)),
    );
    await this.client.sAdd(
      key,
      members.map((memberId) => String(memberId)),
    );
    await this.client.expire(key, this.ttlSeconds);
    return members;
  }

  async pendingDeliveries(userId: number): Promise<PendingDelivery[]> {
    return lastValueFrom(
      this.chatClient
        .send<PendingDelivery[]>(
          { cmd: 'listPendingDeliveries' },
          { actorId: userId },
        )
        .pipe(timeout(3_000)),
    );
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
