// Base interfaces used across all modules — the "contracts" everything depends on.

import { Collection, Db } from 'mongodb';

// ── Repository base ──────────────────────────────────────────────────────────

export interface IRepository {
  readonly collection: Collection;
}

export abstract class BaseRepository implements IRepository {
  readonly collection: Collection;

  constructor(db: Db, collectionName: string) {
    this.collection = db.collection(collectionName);
  }
}

// ── Worker base ───────────────────────────────────────────────────────────────

export interface IWorker {
  start(): void;
  stop(): void;
}

// ── Auth context ──────────────────────────────────────────────────────────────

export interface AuthPlayer {
  walletAddress: string;
}

// ── Pagination ────────────────────────────────────────────────────────────────

export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
