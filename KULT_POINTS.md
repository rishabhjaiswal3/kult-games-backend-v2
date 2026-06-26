# kult-browser-backend-v2 — Kult Points System

## Project Overview

`kult-browser-backend-v2` is an Express.js + TypeScript backend (port of `kult-browser-backend-rust`) providing the API for the Kult Browser gaming platform. It uses a Factory Method pattern for dependency injection, MongoDB for persistence, and Valkey/Redis for background job queues.

**Stack:** Node.js · Express · TypeScript · MongoDB · Valkey (Redis) · JWT + SIWE auth

---

## Architecture

```
src/
├── config.ts                         — all env vars, single source of truth
├── core/                             — error.ts, response.ts, types.ts (IRepository/IWorker)
├── db/                               — mongo.ts, redis.ts (ValkyQueue), logger.ts
├── middleware/                       — auth.ts (JWT + SIWE), localization.ts
├── external/                         — spaces.ts, bright-data.ts, zg-*.ts
├── modules/
│   ├── kult-points/                  — PUBLIC: read-only balance + level + rank
│   ├── internal-kult-points/         — INTERNAL: give / minus points (key-protected)
│   ├── player/                       — auth, profile (includes KP balance)
│   ├── leaderboard/                  — global + per-game leaderboards
│   ├── game/ · content/ · moments/   — game catalogue, content, user moments
│   ├── marketplace/ · social-media/  — marketplace listings, social scraping
│   ├── referral/ · onchain/          — referral flow, on-chain activity logging
│   └── access/ · admin/ · upload/    — access codes, admin tools, presign upload
├── factory/
│   ├── service.factory.ts            — Factory Method; singleton service wiring
│   └── worker.factory.ts             — background worker lifecycle
├── workers/                          — migration, scrape, da-event, compute, onchain
├── app.ts                            — Express app, all routes mounted here
└── index.ts                          — entrypoint: DB connect → workers start → listen
```

---

## Kult Points — How They Work

### 1. Data Model

**Collection:** `kult_points` (configurable via `KULT_POINTS_COLL` env var)

```typescript
interface KultPointsModel {
  _id?: ObjectId;
  walletAddress: string;   // lowercase, trimmed — canonical form
  kultPoints: number;      // always >= 0 (clamped); never negative
  createdAt: Date;
  updatedAt: Date;
}
```

- New wallets start at **0** points (created on first `ensureWallet` call).
- Points are **floor-clamped to 0** — subtracting more than the balance results in 0, never a negative balance.
- `walletAddress` is stored and queried in **lowercase**. Case-insensitive fallback regex is used for legacy records with mixed case.

---

### 2. Level Tiers

Both the public and internal service use the same level function:

| Kult Points      | Level |
|-----------------|-------|
| < 1,000         | 1     |
| >= 1,000        | 20    |
| >= 5,000        | 40    |
| >= 10,000       | 60    |
| >= 50,000       | 80    |
| >= 100,000      | 100   |

Levels are returned in every balance response — they are **computed on the fly**, not stored.

---

### 3. Rank

Rank is computed live from the `kult_points` collection:

```
rank = (count of wallets with kultPoints > this wallet's balance) + 1
```

Wallets with 0 points have `rank: undefined` (unranked).

---

### 4. Repository — `KultPointsRepository`

File: [src/modules/kult-points/kult-points.repository.ts](src/modules/kult-points/kult-points.repository.ts)

| Method | Description |
|--------|-------------|
| `findByWallet(wallet)` | Exact lowercase match, regex fallback for mixed-case legacy docs |
| `findWalletVariants(wallet)` | All case variants for a wallet address |
| `getBalance(wallet)` | Sums all variant docs, clamps to >= 0 |
| `setBalance(wallet, amount)` | Upsert at canonical lowercase key; deduplicates variants |
| `ensureWallet(wallet)` | Insert default (0 pts) doc if not present |
| `countRankByKultPoints(pts)` | Count docs with `kultPoints > pts` (for rank calculation) |
| `bulkSetBalances(entries[])` | Bulk upsert; merges duplicates in-memory before writing |

**Deduplication on write:** `setBalance` detects multiple case-variant documents for the same wallet, writes the canonical lowercase doc, and deletes the duplicates in one operation.

---

### 5. Public API — Read-Only Balance

Service: [src/modules/kult-points/kult-points.service.ts](src/modules/kult-points/kult-points.service.ts)  
Routes: [src/modules/kult-points/kult-points.routes.ts](src/modules/kult-points/kult-points.routes.ts)

**No authentication required.**

#### `GET /api/kp?walletAddress=0x...`
Also available at:
- `GET /api/kult-points?walletAddress=0x...`
- `GET /api/internal/kp?walletAddress=0x...` (legacy read-only alias, no internal key needed)

**Response:**
```json
{
  "walletAddress": "0xabc...",
  "kultPoints": 5200,
  "rank": 14,
  "level": 40,
  "updatedAt": "2025-06-01T12:00:00.000Z"
}
```

`rank` is omitted (`undefined`) when `kultPoints === 0`.

---

### 6. Internal API — Give / Subtract Points

Service: [src/modules/internal-kult-points/internal-kult-points.service.ts](src/modules/internal-kult-points/internal-kult-points.service.ts)  
Routes: [src/modules/internal-kult-points/internal-kult-points.routes.ts](src/modules/internal-kult-points/internal-kult-points.routes.ts)

**Requires an internal API key.** All routes validate the `x-kult-internal-key` header (name configurable via `INTERNAL_KULT_POINTS_HEADER_NAME`) against `INTERNAL_KULT_POINTS_API_KEY` using a **timing-safe comparison** (Node's `crypto.timingSafeEqual`).

#### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/internal/kult-points?walletAddress=0x...` | Same balance read as public, but key-gated |
| `POST` | `/api/internal/kult-points` | Give or subtract points |

Also available at:
- `/api/internal/kp` (legacy alias)
- `/internal/kult-points` and `/internal/kp` (direct backend paths — DigitalOcean may strip `/api`)

#### POST body

```json
{
  "walletAddress": "0xabc...",
  "action": "give",
  "amount": 500
}
```

| Field | Type | Values |
|-------|------|--------|
| `walletAddress` | string | Any wallet address (normalized to lowercase) |
| `action` | string | `"give"` or `"minus"` (alias: `"subtract"`) |
| `amount` | number | Must be a positive finite number |

**Give:** `newBalance = currentBalance + amount`  
**Minus:** `newBalance = max(0, currentBalance - amount)` — never goes below 0

**Response:**
```json
{
  "walletAddress": "0xabc...",
  "kultPoints": 5700,
  "rank": 12,
  "level": 40,
  "updatedAt": "2025-06-01T12:05:00.000Z",
  "action": "give",
  "amount": 500,
  "previousKultPoints": 5200
}
```

---

### 7. Integration with Player Profile

When `GET /api/player/profile` is called, `PlayerService` fetches the kult points balance via `KultPointsService.getKultPoints()` and merges it into the profile response:

```json
{
  "profile": {
    "walletAddress": "0xabc...",
    "username": "kult-player_a1b2c3d4",
    "rank": 14,
    "totalScore": 8200,
    "kultPoints": 5200,
    "kultPointsRank": 12,
    "level": 3,
    ...
  }
}
```

`kultPoints` and `kultPointsRank` come from the `kult_points` collection.  
`rank`, `totalScore`, and `level` come from the global leaderboard (game-score based, separate system).

---

### 8. Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KULT_POINTS_COLL` | `kult_points` | MongoDB collection name |
| `INTERNAL_KULT_POINTS_API_KEY` | — | Secret key for internal routes (required) |
| `INTERNAL_KULT_POINTS_HEADER_NAME` | `x-kult-internal-key` | Header name for the internal key |
| `INTERNAL_KP_API_KEY` | — | Legacy alias for the API key |
| `INTERNAL_KP_HEADER_NAME` | — | Legacy alias for the header name |

---

### 9. Route Map Summary

```
PUBLIC (no auth)
  GET  /api/kp                     → KultPointsService.getKultPoints
  GET  /api/kult-points            → (same)
  GET  /api/internal/kp            → (same, legacy read-only alias)

INTERNAL (x-kult-internal-key required)
  GET  /api/internal/kult-points   → InternalKultPointsService.getKultPoints
  POST /api/internal/kult-points   → InternalKultPointsService.adjustKultPoints
  GET  /api/internal/kp            → (legacy alias)
  POST /api/internal/kp            → (legacy alias)
  GET  /internal/kult-points       → (DigitalOcean direct path)
  POST /internal/kult-points       → (DigitalOcean direct path)
  GET  /internal/kp                → (DigitalOcean direct path)
  POST /internal/kp                → (DigitalOcean direct path)
```

---

### 10. Key Design Decisions

- **Two service classes for one data store.** `KultPointsService` (public, read-only) and `InternalKultPointsService` (write, key-gated) both use the same `KultPointsRepository`. This enforces the security boundary at the service/route layer rather than inside the repository.
- **Wallet address deduplication.** Legacy data may have mixed-case wallet addresses. The repository normalizes on every write and cleans up duplicates automatically.
- **Clamp, never go negative.** Any path that computes a new balance calls `clampKultPoints()` which enforces `>= 0`. This is a business invariant — points are always non-negative.
- **Rank is live, not cached.** A `countDocuments` query runs on every balance read. This is acceptable at current scale; add caching if query latency becomes an issue.
