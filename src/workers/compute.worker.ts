// Runs 0G Compute AI analysis on newly created moments.

import { IWorker } from '../core/types';
import { logger } from '../db/logger';
import { config } from '../config';
import { analyzeMoment } from '../external/zg-compute';
import { MomentsRepository } from '../modules/moments/moments.repository';

const POLL_INTERVAL_MS = 15_000;
const BATCH_SIZE = 5;

export class ComputeWorker implements IWorker {
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly repo: MomentsRepository) {}

  start(): void {
    if (!config.zg.hasCompute()) {
      logger.info('Compute worker disabled — ZG_COMPUTE_PROVIDER_URL or ZG_COMPUTE_API_KEY not set');
      return;
    }
    logger.info('Compute worker started');
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    logger.info('Compute worker stopping');
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
      logger.error({ err }, 'Compute worker tick failed');
    }
    this.schedule();
  }

  private async processBatch(): Promise<void> {
    // Find moments needing AI analysis (aiStatus is null/undefined)
    const pending = await this.repo.getFeed(0, BATCH_SIZE).then((r) =>
      r.moments.filter((m) => !m.aiStatus || m.aiStatus === 'pending'),
    );

    for (const moment of pending) {
      if (this.stopped) break;
      try {
        await this.repo.updateByMomentId(moment.momentId, { aiStatus: 'processing' });

        const analysis = await analyzeMoment(
          moment.title,
          moment.description,
          moment.tags,
          moment.relatedGames,
        );

        if (analysis) {
          await this.repo.updateByMomentId(moment.momentId, {
            aiCaption: analysis.caption,
            aiRankScore: analysis.rankScore,
            aiHighlights: analysis.highlights,
            aiStatus: 'processed',
            aiMomentType: analysis.momentType,
            aiSkillScore: analysis.skillScore,
            aiReactionQuality: analysis.reactionQuality,
            aiRarity: analysis.rarity,
          });
          logger.debug({ momentId: moment.momentId }, 'Compute analysis complete');
        } else {
          await this.repo.updateByMomentId(moment.momentId, { aiStatus: 'unavailable' });
        }
      } catch (err) {
        logger.error({ err, momentId: moment.momentId }, 'Compute analysis failed');
        await this.repo.updateByMomentId(moment.momentId, { aiStatus: 'failed' });
      }
    }
  }
}
