// Scrapes submitted social media posts via Bright Data and validates them.

import { IWorker } from '../core/types';
import { ValkyQueue } from '../db/redis';
import { logger } from '../db/logger';
import { config } from '../config';
import { brightData } from '../external/bright-data';
import { SocialPostRepository } from '../modules/social-media/social-media.repository';
import { ScrapeJob } from '../modules/social-media/social-media.model';

const BATCH_TIMEOUT_SECS = 5;

export class ScrapeWorker implements IWorker {
  private stopped = false;

  constructor(
    private readonly queue: ValkyQueue,
    private readonly repo: SocialPostRepository,
  ) {}

  start(): void {
    logger.info('Scrape worker started');
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    logger.info('Scrape worker stopping');
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      const item = await this.queue.pop<ScrapeJob>(BATCH_TIMEOUT_SECS).catch(() => null);
      if (!item) continue;

      const { payload, raw } = item;
      try {
        await this.processJob(payload);
        await this.queue.ack(raw);
      } catch (err) {
        logger.error({ err, postUrl: payload.postUrl }, 'Scrape job failed');
        await this.queue.ack(raw);
        await this.repo.updateValidationStatus(payload.platform, payload.postId, 'failed');
      }
    }
  }

  private async processJob(job: ScrapeJob): Promise<void> {
    const results = await brightData.scrapeByPlatform(job.platform, [job.postUrl]);
    const raw = results[0];

    const isValid = this.validate(raw);
    const status = isValid ? 'validated' : 'rejected';

    await this.repo.updateValidationStatus(job.platform, job.postId, status, raw);
    logger.info({ platform: job.platform, postId: job.postId, status }, 'Scrape job processed');
  }

  private validate(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false;
    const obj = data as Record<string, unknown>;
    const terms = config.scrape.validationTerms;
    const content = JSON.stringify(obj).toLowerCase();
    return terms.some((term) => content.includes(term.toLowerCase()));
  }
}
