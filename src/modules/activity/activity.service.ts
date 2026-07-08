import { createHash } from 'crypto';
import { AppError } from '../../core/error';
import {
  ACTIVITY_EVENT_TYPES,
  type ActivityEventInput,
  type ActivityEventModel,
  type ActivityHeatmapResponse,
  type ActivitySummaryResponse,
} from './activity.model';
import type { ActivityRepository } from './activity.repository';

const ALLOWED_TYPES = new Set<string>(ACTIVITY_EVENT_TYPES);
const MAX_BATCH = 200;
const MAX_META_KEYS = 24;
const MAX_STRING = 500;
const MAX_META_STRING = 300;

function normalizeWallet(wallet?: string | null): string | null {
  if (!wallet?.trim()) return null;
  return wallet.trim().toLowerCase();
}

function truncate(value: unknown, max = MAX_STRING): string {
  if (value == null) return '';
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}

function sanitizeMeta(meta: unknown): Record<string, unknown> | undefined {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return undefined;
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const [key, raw] of Object.entries(meta as Record<string, unknown>)) {
    if (n >= MAX_META_KEYS) break;
    const k = truncate(key, 64);
    if (!k) continue;
    if (raw == null || typeof raw === 'boolean' || typeof raw === 'number') {
      out[k] = raw;
    } else if (typeof raw === 'string') {
      out[k] = truncate(raw, MAX_META_STRING);
    } else {
      out[k] = truncate(JSON.stringify(raw), MAX_META_STRING);
    }
    n += 1;
  }
  return Object.keys(out).length ? out : undefined;
}

function hashIp(ip?: string | null): string | undefined {
  if (!ip?.trim()) return undefined;
  return createHash('sha256').update(ip.trim()).digest('hex').slice(0, 32);
}

function dayParts(date: Date): { dayKey: string; hour: number; weekday: number } {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return {
    dayKey: `${y}-${m}-${d}`,
    hour: date.getUTCHours(),
    weekday: date.getUTCDay(),
  };
}

function sanitizePointer(pointer: ActivityEventInput['pointer']): ActivityEventModel['pointer'] | undefined {
  if (!pointer) return undefined;
  const x = Number(pointer.x);
  const y = Number(pointer.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const nx = pointer.nx != null ? Number(pointer.nx) : undefined;
  const ny = pointer.ny != null ? Number(pointer.ny) : undefined;
  return {
    x: Math.round(x),
    y: Math.round(y),
    pageX: pointer.pageX != null && Number.isFinite(Number(pointer.pageX)) ? Math.round(Number(pointer.pageX)) : undefined,
    pageY: pointer.pageY != null && Number.isFinite(Number(pointer.pageY)) ? Math.round(Number(pointer.pageY)) : undefined,
    nx: nx != null && Number.isFinite(nx) ? Math.min(1, Math.max(0, nx)) : undefined,
    ny: ny != null && Number.isFinite(ny) ? Math.min(1, Math.max(0, ny)) : undefined,
  };
}

function sanitizeTarget(target: ActivityEventInput['target']): ActivityEventModel['target'] | undefined {
  if (!target || typeof target !== 'object') return undefined;
  return {
    tag: truncate(target.tag, 40) || undefined,
    id: truncate(target.id, 120) || undefined,
    classes: truncate(target.classes, 200) || undefined,
    text: truncate(target.text, 160) || undefined,
    href: truncate(target.href, 300) || undefined,
    name: truncate(target.name, 120) || undefined,
    role: truncate(target.role, 60) || undefined,
    type: truncate(target.type, 60) || undefined,
    dataTour: truncate(target.dataTour, 120) || undefined,
    selector: truncate(target.selector, 280) || undefined,
  };
}

export class ActivityService {
  constructor(private readonly repo: ActivityRepository) {}

  async ingestBatch(params: {
    events: ActivityEventInput[];
    walletAddress?: string | null;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<{ accepted: number; dropped: number }> {
    const raw = Array.isArray(params.events) ? params.events : [];
    if (!raw.length) throw AppError.badRequest('events array is required');
    if (raw.length > MAX_BATCH) throw AppError.badRequest(`Max ${MAX_BATCH} events per request`);

    const wallet = normalizeWallet(params.walletAddress);
    const ua = truncate(params.userAgent, 300) || undefined;
    const ipHash = hashIp(params.ip);
    const now = Date.now();
    const docs: ActivityEventModel[] = [];
    let dropped = 0;

    for (const event of raw) {
      if (!event || typeof event !== 'object') {
        dropped += 1;
        continue;
      }

      const type = truncate(event.type, 40).toLowerCase() || 'custom';
      if (!ALLOWED_TYPES.has(type) && type !== 'custom') {
        // Still accept unknown types as custom to avoid losing sparse signals.
      }

      const sessionId = truncate(event.sessionId, 80);
      const anonymousId = truncate(event.anonymousId, 80);
      if (!sessionId || !anonymousId) {
        dropped += 1;
        continue;
      }

      const clientTs = event.ts != null ? Number(event.ts) : now;
      const safeTs = Number.isFinite(clientTs)
        ? new Date(Math.min(now + 60_000, Math.max(now - 7 * 24 * 60 * 60_000, clientTs)))
        : new Date(now);

      const parts = dayParts(safeTs);
      const createdAt = new Date();

      docs.push({
        walletAddress: wallet,
        sessionId,
        anonymousId,
        type: ALLOWED_TYPES.has(type) ? type : 'custom',
        name: truncate(event.name || type, 120) || type,
        path: truncate(event.path || '/', 400) || '/',
        referrer: truncate(event.referrer, 400),
        ts: safeTs,
        createdAt,
        dayKey: parts.dayKey,
        hour: parts.hour,
        weekday: parts.weekday,
        pointer: sanitizePointer(event.pointer),
        target: sanitizeTarget(event.target),
        viewport: event.viewport
          ? {
              w: Math.round(Number(event.viewport.w) || 0),
              h: Math.round(Number(event.viewport.h) || 0),
              scrollX: event.viewport.scrollX != null ? Math.round(Number(event.viewport.scrollX) || 0) : undefined,
              scrollY: event.viewport.scrollY != null ? Math.round(Number(event.viewport.scrollY) || 0) : undefined,
              dpr: event.viewport.dpr != null ? Number(event.viewport.dpr) : undefined,
            }
          : undefined,
        durationMs:
          event.durationMs != null && Number.isFinite(Number(event.durationMs))
            ? Math.max(0, Math.round(Number(event.durationMs)))
            : undefined,
        value:
          typeof event.value === 'string'
            ? truncate(event.value, 200)
            : typeof event.value === 'number' || typeof event.value === 'boolean' || event.value == null
              ? event.value
              : truncate(JSON.stringify(event.value), 200),
        meta: sanitizeMeta(event.meta),
        userAgent: ua,
        ipHash,
      });
    }

    if (!docs.length) throw AppError.badRequest('No valid events to ingest');
    const accepted = await this.repo.insertMany(docs);
    return { accepted, dropped: dropped + (raw.length - docs.length) };
  }

  async heatmap(params: {
    path: string;
    from?: string;
    to?: string;
    gridSize?: number;
    walletAddress?: string | null;
    types?: string[];
  }): Promise<ActivityHeatmapResponse> {
    const path = truncate(params.path, 400);
    if (!path) throw AppError.badRequest('path is required');
    const { from, to } = resolveRange(params.from, params.to);
    return this.repo.getHeatmap({
      path,
      from,
      to,
      gridSize: params.gridSize ?? 40,
      walletAddress: normalizeWallet(params.walletAddress),
      types: params.types,
    });
  }

  async summary(params: {
    from?: string;
    to?: string;
    walletAddress?: string | null;
    pathPrefix?: string;
  }): Promise<ActivitySummaryResponse> {
    const { from, to } = resolveRange(params.from, params.to);
    return this.repo.getSummary({
      from,
      to,
      walletAddress: normalizeWallet(params.walletAddress),
      pathPrefix: params.pathPrefix ? truncate(params.pathPrefix, 200) : undefined,
    });
  }

  async recent(params: {
    limit?: number;
    walletAddress?: string | null;
    path?: string;
    type?: string;
  }): Promise<ActivityEventModel[]> {
    return this.repo.listRecent({
      limit: params.limit ?? 50,
      walletAddress: normalizeWallet(params.walletAddress),
      path: params.path ? truncate(params.path, 400) : undefined,
      type: params.type ? truncate(params.type, 40) : undefined,
    });
  }
}

function resolveRange(fromRaw?: string, toRaw?: string): { from: Date; to: Date } {
  const to = toRaw ? new Date(toRaw) : new Date();
  const from = fromRaw ? new Date(fromRaw) : new Date(to.getTime() - 7 * 24 * 60 * 60_000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw AppError.badRequest('Invalid from/to date');
  }
  if (from > to) throw AppError.badRequest('from must be before to');
  // Cap range to 90 days to keep aggregations cheap.
  if (to.getTime() - from.getTime() > 90 * 24 * 60 * 60_000) {
    throw AppError.badRequest('Date range cannot exceed 90 days');
  }
  return { from, to };
}
