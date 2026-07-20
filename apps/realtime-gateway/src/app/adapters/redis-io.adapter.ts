import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter, createShardedAdapter } from '@socket.io/redis-adapter';
import {
  createClient,
  createCluster,
  RedisClientType,
  RedisClusterType,
} from 'redis';
import { Server, ServerOptions } from 'socket.io';
import { InfrastructureHealthService } from '../infrastructure-health.service';

type RedisConnection = RedisClientType | RedisClusterType;
type SocketIoRedisAdapter =
  ReturnType<typeof createAdapter> | ReturnType<typeof createShardedAdapter>;

export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor?: SocketIoRedisAdapter;
  private pubClient?: RedisConnection;
  private subClient?: RedisConnection;

  constructor(
    app: INestApplicationContext,
    private readonly config: ConfigService,
    private readonly health: InfrastructureHealthService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const clusterNodes = this.config
      .get<string>('REDIS_CLUSTER_NODES')
      ?.split(',')
      .map((node) => node.trim())
      .filter(Boolean);

    if (clusterNodes?.length) {
      this.pubClient = createCluster({
        rootNodes: clusterNodes.map((url) => ({ url })),
      });
      this.subClient = this.pubClient.duplicate();
      this.adapterConstructor = createShardedAdapter(
        this.pubClient,
        this.subClient,
        {
          channelPrefix: 'social-backend:socket.io',
          subscriptionMode: 'dynamic',
        },
      );
    } else {
      this.pubClient = createClient({
        url: this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379',
      });
      this.subClient = this.pubClient.duplicate();
      this.adapterConstructor = createAdapter(this.pubClient, this.subClient, {
        key: 'social-backend:socket.io',
        publishOnSpecificResponseChannel: true,
      });
    }

    this.pubClient.on('error', (error: Error) => {
      this.health.setRedisReady(false);
      this.logger.error(`Redis publisher error: ${error.message}`);
    });
    this.subClient.on('error', (error: Error) => {
      this.health.setRedisReady(false);
      this.logger.error(`Redis subscriber error: ${error.message}`);
    });

    await Promise.all([this.pubClient.connect(), this.subClient.connect()]);
    this.health.setRedisReady(true);
    this.logger.log('Socket.IO Redis adapter connected');
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    if (!this.adapterConstructor) {
      throw new Error('RedisIoAdapter must connect before creating the server');
    }

    const configuredOrigins = this.config.get<string>('WS_CORS_ORIGINS');
    const allowedOrigins = (configuredOrigins ?? 'http://localhost:4200')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    const allowLocalNetworkOrigins = !configuredOrigins;

    const server = super.createIOServer(port, {
      ...options,
      cors: {
        credentials: true,
        origin: (
          origin: string | undefined,
          callback: (error: Error | null, allow?: boolean) => void,
        ) => {
          const allowed =
            !origin ||
            allowedOrigins.includes(origin) ||
            (allowLocalNetworkOrigins && isLocalNetworkFrontendOrigin(origin));
          callback(allowed ? null : new Error('WebSocket origin is not allowed'), allowed);
        },
      },
      maxHttpBufferSize: 64 * 1024,
      perMessageDeflate: false,
      transports: ['websocket'],
    }) as Server;

    server.adapter(this.adapterConstructor);
    return server;
  }

  override async close(server: Server): Promise<void> {
    this.health.setRedisReady(false);
    await super.close(server);

    await Promise.all(
      [this.pubClient, this.subClient]
        .filter((client): client is RedisConnection => Boolean(client?.isOpen))
        .map((client) => client.close()),
    );
  }
}

function isLocalNetworkFrontendOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.port !== '4200') {
      return false;
    }

    const hostname = url.hostname.toLowerCase();
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local') ||
      /^10(?:\.\d{1,3}){3}$/.test(hostname) ||
      /^192\.168(?:\.\d{1,3}){2}$/.test(hostname) ||
      /^172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/.test(hostname)
    );
  } catch {
    return false;
  }
}
