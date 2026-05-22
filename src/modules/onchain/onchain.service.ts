import { createHash } from 'crypto';
import { nanoid } from 'nanoid';
import { logger } from '../../db/logger';
import { OnchainActivityRepository } from './onchain.repository';
import { ActivityTypeValue, OnchainActivityJob } from './onchain.model';

export function metadataHash(data: unknown): string {
  const json = JSON.stringify(data);
  return '0x' + createHash('sha256').update(json).digest('hex');
}

export class OnchainActivityService {
  constructor(private readonly repo: OnchainActivityRepository) {}

  async recordActivity(input: {
    userWallet: string;
    activityType: ActivityTypeValue;
    momentId: string;
    entityId: string;
    metadata: unknown;
  }): Promise<void> {
    const now = new Date();
    const job: OnchainActivityJob = {
      activityId: nanoid(),
      userWallet: input.userWallet,
      activityType: input.activityType,
      momentId: input.momentId,
      entityId: input.entityId,
      metadataHash: metadataHash(input.metadata),
      status: 'pending',
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    };

    await this.repo.create(job).catch((err) => {
      logger.error({ err, momentId: input.momentId }, 'Failed to create onchain activity job');
    });
  }
}
