// Migrates moment assets from DO Spaces to 0G Storage.
// Reliable queue pattern: BRPOPLPUSH → process → LREM (ack)

import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { IWorker } from '../core/types';
import { ValkyQueue } from '../db/redis';
import { logger } from '../db/logger';
import { config, QUEUES } from '../config';
import { uploadFile } from '../external/zg-storage';
import { MomentsRepository } from '../modules/moments/moments.repository';
import { MigrationJob } from '../modules/moments/moments.model';

const BATCH_TIMEOUT_SECS = 5;
const DLQ_MAX_ATTEMPTS = config.scrape.maxRetries;

export class MigrationWorker implements IWorker {
  private stopped = false;
  private readonly dlq: ValkyQueue;

  constructor(
    private readonly queue: ValkyQueue,
    private readonly repo: MomentsRepository,
  ) {
    this.dlq = new ValkyQueue(queue.redis, QUEUES.migrationDlq);
  }

  start(): void {
    logger.info('Migration worker started');
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    logger.info('Migration worker stopping');
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      const item = await this.queue.pop<MigrationJob>(BATCH_TIMEOUT_SECS).catch(() => null);
      if (!item) continue;

      const { payload, raw } = item;
      try {
        await this.processJob(payload);
        await this.queue.ack(raw);
        logger.info({ momentId: payload.momentId }, 'Migration job completed');
      } catch (err) {
        logger.error({ err, momentId: payload.momentId, attempt: payload.attempt }, 'Migration job failed');

        if (payload.attempt >= DLQ_MAX_ATTEMPTS) {
          await this.queue.ack(raw);
          await this.dlq.push({ ...payload, failedAt: new Date().toISOString() });
          await this.repo.updateByMomentId(payload.momentId, {
            zgStatus: 'failed',
            zgError: `Max retries exceeded: ${String(err)}`,
          });
        } else {
          await this.queue.ack(raw);
          await this.queue.push({ ...payload, attempt: payload.attempt + 1 });
        }
      }
    }
  }

  private async processJob(job: MigrationJob): Promise<void> {
    await this.repo.updateByMomentId(job.momentId, { zgStatus: 'migrating' });

    const tmpDir = config.spaces.tmpDir;
    fs.mkdirSync(tmpDir, { recursive: true });
    const ext = path.extname(job.assetUrl).split('?')[0] ?? '';
    const tmpFile = path.join(tmpDir, `${job.momentId}${ext}`);

    try {
      // Download from DO Spaces
      const response = await axios.get(job.assetUrl, { responseType: 'arraybuffer' });
      fs.writeFileSync(tmpFile, response.data as Buffer);

      // Upload asset to 0G
      const assetResult = uploadFile(tmpFile);

      // Upload metadata JSON to 0G
      const metadata = {
        momentId: job.momentId,
        assetZgHash: assetResult.rootHash,
        assetType: job.assetType,
        migratedAt: new Date().toISOString(),
      };
      const metaTmpFile = `${tmpFile}.meta.json`;
      fs.writeFileSync(metaTmpFile, JSON.stringify(metadata));
      const metaResult = uploadFile(metaTmpFile);

      await this.repo.updateByMomentId(job.momentId, {
        assetZgHash: assetResult.rootHash,
        assetZgTxHash: assetResult.txHash ?? undefined,
        metadataZgHash: metaResult.rootHash,
        metadataZgTxHash: metaResult.txHash ?? undefined,
        zgStatus: 'completed',
        zgUploadedAt: new Date(),
        zgError: undefined,
      });

      fs.unlinkSync(metaTmpFile);
    } finally {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
  }
}
