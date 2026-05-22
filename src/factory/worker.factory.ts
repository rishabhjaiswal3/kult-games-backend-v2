// Factory Method Pattern — creates and manages all background workers.
// Workers are stateful (started/stopped), so this factory also owns their lifecycle.

import { IWorker } from '../core/types';
import { ServiceFactory } from './service.factory';
import { MigrationWorker } from '../workers/migration.worker';
import { ScrapeWorker } from '../workers/scrape.worker';
import { DaEventWorker } from '../workers/da-event.worker';
import { ComputeWorker } from '../workers/compute.worker';
import { OnchainActivityWorker } from '../workers/onchain.worker';
import { logger } from '../db/logger';

export class WorkerFactory {
  private readonly workers: IWorker[] = [];

  constructor(private readonly services: ServiceFactory) {}

  // ── Factory methods — each creates one worker ─────────────────────────────

  createMigrationWorker(): MigrationWorker {
    return new MigrationWorker(
      this.services.migrationQueue(),
      this.services.getMomentsRepo(),
    );
  }

  createScrapeWorker(): ScrapeWorker {
    return new ScrapeWorker(
      this.services.scrapeQueue(),
      this.services.getSocialPostRepo(),
    );
  }

  createDaEventWorker(): DaEventWorker {
    const momentsRepo = this.services.getMomentsRepo();
    // DaEventRepository is accessible via MomentsRepository's db
    // For simplicity, pass a dummy — it checks config before doing anything real
    const { DaEventRepository } = require('../modules/moments/moments.repository');
    return new DaEventWorker(new DaEventRepository((momentsRepo as unknown as { collection: { db: unknown } }).collection.db));
  }

  createComputeWorker(): ComputeWorker {
    return new ComputeWorker(this.services.getMomentsRepo());
  }

  createOnchainWorker(): OnchainActivityWorker {
    return new OnchainActivityWorker(this.services.getOnchainRepo());
  }

  // ── Lifecycle management ───────────────────────────────────────────────────

  startAll(): void {
    const all: IWorker[] = [
      this.createMigrationWorker(),
      this.createScrapeWorker(),
      this.createDaEventWorker(),
      this.createComputeWorker(),
      this.createOnchainWorker(),
    ];

    for (const worker of all) {
      this.workers.push(worker);
      worker.start();
    }

    logger.info({ count: this.workers.length }, 'All workers started');
  }

  stopAll(): void {
    for (const worker of this.workers) {
      worker.stop();
    }
    logger.info({ count: this.workers.length }, 'All workers stopped');
  }
}
