import Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

let redisClient: Redis;

export function connectRedis(): Redis {
  redisClient = new Redis(config.redis.url, {
    lazyConnect: false,
    maxRetriesPerRequest: null,
  });

  redisClient.on('connect', () => logger.info('Redis connected'));
  redisClient.on('error', (err) => logger.error({ err }, 'Redis error'));

  return redisClient;
}

export function getRedis(): Redis {
  if (!redisClient) throw new Error('Redis not connected — call connectRedis() first');
  return redisClient;
}

// ── Reliable queue ────────────────────────────────────────────────────────────
// Implements at-least-once delivery: LPUSH → BRPOPLPUSH → LREM (ack)
// Stalled jobs (in processing queue but worker crashed) are recovered via recoverStalledJobs().

export class ValkyQueue {
  private readonly processingQueue: string;

  constructor(
    public readonly redis: Redis,
    public readonly queueName: string,
  ) {
    this.processingQueue = `${queueName}:processing`;
  }

  async push<T>(payload: T): Promise<void> {
    await this.redis.lpush(this.queueName, JSON.stringify(payload));
  }

  async pop<T>(timeoutSecs: number): Promise<{ payload: T; raw: string } | null> {
    const raw = await this.redis.brpoplpush(this.queueName, this.processingQueue, timeoutSecs);
    if (!raw) return null;
    return { payload: JSON.parse(raw) as T, raw };
  }

  async ack(raw: string): Promise<void> {
    await this.redis.lrem(this.processingQueue, 1, raw);
  }

  async nack(raw: string, dlqName: string): Promise<void> {
    await this.redis.lrem(this.processingQueue, 1, raw);
    await this.redis.lpush(dlqName, raw);
  }

  async recoverStalledJobs(): Promise<number> {
    const stalled = await this.redis.lrange(this.processingQueue, 0, -1);
    for (const job of stalled) {
      await this.redis.rpoplpush(this.processingQueue, this.queueName);
    }
    return stalled.length;
  }
}
