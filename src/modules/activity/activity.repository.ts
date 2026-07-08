import { Db } from 'mongodb';
import { BaseRepository } from '../../core/types';
import { config } from '../../config';
import type {
  ActivityEventModel,
  ActivityHeatmapCell,
  ActivityHeatmapResponse,
  ActivitySummaryBucket,
  ActivitySummaryResponse,
} from './activity.model';

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

export class ActivityRepository extends BaseRepository {
  constructor(db: Db) {
    super(db, config.db.col.activityEvents);
  }

  async insertMany(docs: ActivityEventModel[]): Promise<number> {
    if (!docs.length) return 0;
    const result = await this.collection.insertMany(docs as unknown as Parameters<typeof this.collection.insertMany>[0], {
      ordered: false,
    });
    return result.insertedCount;
  }

  async getHeatmap(params: {
    path: string;
    from: Date;
    to: Date;
    gridSize: number;
    walletAddress?: string | null;
    types?: string[];
  }): Promise<ActivityHeatmapResponse> {
    const gridSize = clamp(Math.floor(params.gridSize) || 40, 10, 80);
    const match: Record<string, unknown> = {
      path: params.path,
      ts: { $gte: params.from, $lte: params.to },
      'pointer.nx': { $type: 'number' },
      'pointer.ny': { $type: 'number' },
    };
    if (params.walletAddress) {
      match.walletAddress = params.walletAddress.toLowerCase();
    }
    if (params.types?.length) {
      match.type = { $in: params.types };
    }

    const rows = await this.collection
      .aggregate<{ _id: { x: number; y: number }; count: number }>([
        { $match: match },
        {
          $project: {
            x: {
              $min: [
                gridSize - 1,
                { $floor: { $multiply: ['$pointer.nx', gridSize] } },
              ],
            },
            y: {
              $min: [
                gridSize - 1,
                { $floor: { $multiply: ['$pointer.ny', gridSize] } },
              ],
            },
          },
        },
        {
          $group: {
            _id: { x: '$x', y: '$y' },
            count: { $sum: 1 },
          },
        },
        { $sort: { count: -1 } },
        { $limit: gridSize * gridSize },
      ])
      .toArray();

    const cells: ActivityHeatmapCell[] = rows
      .filter((r) => Number.isFinite(r._id.x) && Number.isFinite(r._id.y))
      .map((r) => ({
        x: r._id.x,
        y: r._id.y,
        count: r.count,
      }));

    const totalEvents = cells.reduce((sum, c) => sum + c.count, 0);

    return {
      path: params.path,
      from: params.from.toISOString(),
      to: params.to.toISOString(),
      gridSize,
      cells,
      totalEvents,
    };
  }

  async getSummary(params: {
    from: Date;
    to: Date;
    walletAddress?: string | null;
    pathPrefix?: string;
  }): Promise<ActivitySummaryResponse> {
    const match: Record<string, unknown> = {
      ts: { $gte: params.from, $lte: params.to },
    };
    if (params.walletAddress) {
      match.walletAddress = params.walletAddress.toLowerCase();
    }
    if (params.pathPrefix) {
      match.path = { $regex: `^${escapeRegex(params.pathPrefix)}` };
    }

    const [totals, byType, byPath, byHour, byDay, topTargets] = await Promise.all([
      this.collection.countDocuments(match),
      this.bucket(match, '$type', 40),
      this.bucket(match, '$path', 40),
      this.bucket(match, '$hour', 24),
      this.bucket(match, '$dayKey', 90),
      this.bucket(match, {
        $ifNull: [
          '$target.dataTour',
          { $ifNull: ['$target.selector', { $ifNull: ['$target.id', '$target.tag'] }] },
        ],
      }, 40),
    ]);

    return {
      from: params.from.toISOString(),
      to: params.to.toISOString(),
      totalEvents: totals,
      byType,
      byPath,
      byHour: byHour.map((b) => ({ key: String(b.key), count: b.count })),
      byDay,
      topTargets,
    };
  }

  async listRecent(params: {
    limit: number;
    walletAddress?: string | null;
    path?: string;
    type?: string;
  }): Promise<ActivityEventModel[]> {
    const match: Record<string, unknown> = {};
    if (params.walletAddress) match.walletAddress = params.walletAddress.toLowerCase();
    if (params.path) match.path = params.path;
    if (params.type) match.type = params.type;

    return this.collection
      .find<ActivityEventModel>(match)
      .sort({ ts: -1 })
      .limit(clamp(params.limit || 50, 1, 200))
      .toArray();
  }

  private async bucket(
    match: Record<string, unknown>,
    groupKey: string | Record<string, unknown>,
    limit: number,
  ): Promise<ActivitySummaryBucket[]> {
    const rows = await this.collection
      .aggregate<{ _id: string | number | null; count: number }>([
        { $match: match },
        { $group: { _id: groupKey, count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: limit },
      ])
      .toArray();

    return rows
      .filter((r) => r._id != null && r._id !== '')
      .map((r) => ({ key: String(r._id), count: r.count }));
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
