// Disperses moment DA events to 0G DA.

import { IWorker } from '../core/types';
import { logger } from '../db/logger';
import { config } from '../config';
import { disperseBlob, waitForFinalization } from '../external/zg-da';
import { DaEventRepository } from '../modules/moments/moments.repository';

const POLL_INTERVAL_MS = 10_000;

export class DaEventWorker implements IWorker {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly repo: DaEventRepository) {}

  start(): void {
    if (!config.zg.daDisperserUrl) {
      logger.info('DA event worker disabled — ZG_DA_DISPERSER_URL not configured');
      return;
    }
    logger.info('DA event worker started');
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    logger.info('DA event worker stopping');
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.processBatch();
    } catch (err) {
      logger.error({ err }, 'DA event worker tick failed');
    }
    this.schedule();
  }

  private async processBatch(): Promise<void> {
    // In a real implementation, we'd store pending DA events and process them here.
    // For now, this is a placeholder that demonstrates the pattern.
    logger.debug('DA event worker batch (placeholder)');
  }
}
