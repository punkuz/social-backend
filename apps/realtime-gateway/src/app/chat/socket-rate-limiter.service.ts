import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface WindowCounter {
  count: number;
  startedAt: number;
}

@Injectable()
export class SocketRateLimiterService {
  private readonly counters = new Map<string, WindowCounter>();
  private readonly limits: Record<'message' | 'receipt' | 'typing', number>;

  constructor(config: ConfigService) {
    this.limits = {
      message: positiveInteger(config.get('WS_MESSAGE_RATE_PER_SECOND'), 20),
      receipt: positiveInteger(config.get('WS_RECEIPT_RATE_PER_SECOND'), 60),
      typing: positiveInteger(config.get('WS_TYPING_RATE_PER_SECOND'), 10),
    };
  }

  consume(
    socketId: string,
    bucket: 'message' | 'receipt' | 'typing',
  ): boolean {
    const now = Date.now();
    const key = `${socketId}:${bucket}`;
    const counter = this.counters.get(key);

    if (!counter || now - counter.startedAt >= 1_000) {
      this.counters.set(key, { count: 1, startedAt: now });
      return true;
    }

    counter.count += 1;
    return counter.count <= this.limits[bucket];
  }

  clear(socketId: string): void {
    for (const bucket of ['message', 'receipt', 'typing']) {
      this.counters.delete(`${socketId}:${bucket}`);
    }
  }
}

function positiveInteger(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('WebSocket rate limits must be positive integers');
  }
  return parsed;
}
