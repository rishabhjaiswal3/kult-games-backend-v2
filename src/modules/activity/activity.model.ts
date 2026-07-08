/** Product activity / heatmap event kinds captured from the SPA. */
export const ACTIVITY_EVENT_TYPES = [
  'page_view',
  'page_leave',
  'click',
  'dblclick',
  'context_menu',
  'pointer_down',
  'pointer_up',
  'mousemove',
  'hover',
  'scroll',
  'visibility',
  'focus',
  'blur',
  'input',
  'change',
  'submit',
  'keydown',
  'keyup',
  'copy',
  'paste',
  'selection',
  'resize',
  'route_change',
  'api_request',
  'api_error',
  'error',
  'performance',
  'idle',
  'custom',
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

export interface ActivityPointer {
  /** Viewport X (px). */
  x: number;
  /** Viewport Y (px). */
  y: number;
  /** Document X (px). */
  pageX?: number;
  /** Document Y (px). */
  pageY?: number;
  /** Normalized 0–1 within viewport. */
  nx?: number;
  /** Normalized 0–1 within viewport. */
  ny?: number;
}

export interface ActivityTarget {
  tag?: string;
  id?: string;
  classes?: string;
  text?: string;
  href?: string;
  name?: string;
  role?: string;
  type?: string;
  /** Existing product tour / analytics anchor. */
  dataTour?: string;
  /** CSS path-ish selector for heatmap reconstrution. */
  selector?: string;
}

export interface ActivityViewport {
  w: number;
  h: number;
  scrollX?: number;
  scrollY?: number;
  dpr?: number;
}

/** Raw event as sent by the client (pre-persist). */
export interface ActivityEventInput {
  type: ActivityEventType | string;
  name?: string;
  path?: string;
  referrer?: string;
  ts?: number;
  sessionId?: string;
  anonymousId?: string;
  pointer?: ActivityPointer;
  target?: ActivityTarget;
  viewport?: ActivityViewport;
  durationMs?: number;
  value?: string | number | boolean | null;
  meta?: Record<string, unknown>;
}

export interface ActivityEventModel {
  walletAddress: string | null;
  sessionId: string;
  anonymousId: string;
  type: string;
  name: string;
  path: string;
  referrer: string;
  ts: Date;
  createdAt: Date;
  dayKey: string;
  hour: number;
  weekday: number;
  pointer?: ActivityPointer;
  target?: ActivityTarget;
  viewport?: ActivityViewport;
  durationMs?: number;
  value?: string | number | boolean | null;
  meta?: Record<string, unknown>;
  userAgent?: string;
  ipHash?: string;
}

export interface ActivityHeatmapCell {
  x: number;
  y: number;
  count: number;
}

export interface ActivityHeatmapResponse {
  path: string;
  from: string;
  to: string;
  gridSize: number;
  cells: ActivityHeatmapCell[];
  totalEvents: number;
}

export interface ActivitySummaryBucket {
  key: string;
  count: number;
}

export interface ActivitySummaryResponse {
  from: string;
  to: string;
  totalEvents: number;
  byType: ActivitySummaryBucket[];
  byPath: ActivitySummaryBucket[];
  byHour: ActivitySummaryBucket[];
  byDay: ActivitySummaryBucket[];
  topTargets: ActivitySummaryBucket[];
}
