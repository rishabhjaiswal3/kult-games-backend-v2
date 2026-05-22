# kult-browser-backend-v2

Express.js + TypeScript backend for the **Kult Browser** — a Web3 gaming platform with on-chain activity tracking, NFT marketplace, social moments, leaderboards, and 0G Network storage integration.

> This is a complete port of `kult-browser-backend-rust` to Node.js. The same `.env.example` works without changes, and all API contracts are identical.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 + TypeScript (ES2022, strict) |
| HTTP | Express.js |
| Database | MongoDB (native driver) |
| Cache / Queue | Redis / Valkey (ioredis) |
| Auth | JWT + SIWE (Sign-In with Ethereum, EIP-4361) |
| Storage | DigitalOcean Spaces (AWS S3 SDK) |
| Scraping | Bright Data API |
| Decentralized Storage | 0G Storage (CLI binary wrapper) |
| DA Layer | 0G DA Disperser (HTTP client) |
| AI Analysis | 0G Compute (OpenAI-compatible API) |
| On-chain | ethers.js v6 — EVM contract calls |
| Logging | Pino (pretty in dev, JSON in prod) |

---

## Project Structure

```
src/
├── config.ts                    # Single source of truth for all env vars
│
├── core/                        # Shared foundations — no business logic here
│   ├── types.ts                 # IRepository, IWorker, AuthPlayer, PaginatedResult
│   ├── error.ts                 # AppError with typed factory methods (badRequest, notFound…)
│   └── response.ts              # ok() helper + global Express error handler
│
├── db/                          # Infrastructure connections
│   ├── logger.ts                # Pino logger instance
│   ├── mongo.ts                 # MongoDB connect + ensureIndexes()
│   └── redis.ts                 # Redis connect + ValkyQueue (reliable queue pattern)
│
├── middleware/                  # Express middleware
│   ├── auth.ts                  # requireAuth, requireAdmin, signToken, SIWE helpers
│   └── localization.ts          # Accept-Language → req.locale
│
├── external/                    # Third-party service clients
│   ├── spaces.ts                # DigitalOcean Spaces — presign, fileExists, publicUrl
│   ├── bright-data.ts           # Bright Data scraper — trigger → poll → download
│   ├── zg-storage.ts            # 0G Storage — CLI binary wrapper
│   ├── zg-da.ts                 # 0G DA — disperseBlob, waitForFinalization
│   └── zg-compute.ts            # 0G Compute — analyzeMoment (OpenAI-compatible)
│
├── modules/                     # Feature modules — each is self-contained
│   ├── player/                  # SIWE login, JWT, player profile
│   ├── agent/                   # AI agent wallet creation for new players
│   ├── game/                    # Game catalog with play counts and knowledge facts
│   ├── content/                 # CMS content sections (home page picks etc.)
│   ├── leaderboard/             # Global + per-game leaderboards
│   ├── marketplace/             # NFT listings and orders
│   ├── moments/                 # User moments — create, feed, likes, 0G migration
│   ├── social-media/            # Social post submission and validation via Bright Data
│   ├── referral/                # Referral codes, click tracking, signup rewards
│   ├── onchain/                 # EVM activity recording jobs
│   ├── upload/                  # Presigned upload URL generation
│   └── admin/                   # Admin-only config endpoints
│
├── workers/                     # Background workers (run in the same process)
│   ├── migration.worker.ts      # Migrates moment assets from DO Spaces → 0G Storage
│   ├── scrape.worker.ts         # Scrapes and validates submitted social posts
│   ├── da-event.worker.ts       # Disperses DA events to 0G DA
│   ├── compute.worker.ts        # Runs AI analysis on moments via 0G Compute
│   └── onchain.worker.ts        # Submits pending activity jobs to EVM contract
│
├── factory/                     # Dependency wiring — Factory Method pattern
│   ├── service.factory.ts       # Creates all services as singletons with deps injected
│   └── worker.factory.ts        # Creates all workers + manages start/stop lifecycle
│
├── app.ts                       # Express app — routes + middleware wired via ServiceFactory
└── index.ts                     # Entry point — DB → Redis → indexes → workers → server
```

Each module follows the same flat convention:

```
modules/<name>/
  <name>.model.ts       # TypeScript interfaces (DB shape + DTOs)
  <name>.repository.ts  # MongoDB queries — extends BaseRepository
  <name>.service.ts     # Business logic — no Express types here
  <name>.routes.ts      # Express router — thin, delegates to service
```

---

## Design Patterns

### Factory Method (LLD)
`ServiceFactory` is the central wiring point. Each `create*()` method is a factory method that builds its service with all dependencies resolved and returns a singleton instance.

```
ServiceFactory.createPlayerService()
  → PlayerService(PlayerRepo, NonceRepo, GlobalLbRepo, GameLbService, AgentRepo, …)
```

No service ever instantiates its own dependencies — they are all injected through the factory.

`WorkerFactory` follows the same pattern for background workers.

### SOLID
- **Single Responsibility** — repositories only query, services only apply business logic, routes only parse HTTP
- **Open/Closed** — adding a new module doesn't touch existing code; register it in `app.ts`
- **Interface Segregation** — `IRepository` and `IWorker` are minimal contracts
- **Dependency Inversion** — services depend on repository interfaces, not concrete MongoDB calls

### DRY
- `BaseRepository` — one place for collection access
- `AppError` — one place for typed HTTP errors
- `ok()` — one place for success response shape
- `ValkyQueue` — one place for reliable queue logic (LPUSH → BRPOPLPUSH → LREM)

---

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/player/nonce` | — | Issue SIWE nonce |
| POST | `/api/player/login` | — | SIWE login / register |
| GET | `/api/player/profile` | ✓ | Authenticated player profile |
| PATCH | `/api/player/name` | ✓ | Update display name |
| GET | `/api/games` | — | Paginated game catalog |
| GET | `/api/games/categories` | — | All categories |
| GET | `/api/games/:id` | — | Single game detail |
| GET | `/api/content` | — | CMS content section |
| GET | `/api/leaderboard/global` | — | Global leaderboard |
| POST | `/api/leaderboard/refresh` | ✓ | Rebuild global leaderboard |
| GET | `/api/leaderboard/game/:id` | — | Per-game leaderboard |
| GET | `/api/marketplace` | — | Active listings |
| GET | `/api/marketplace/:id` | — | Single listing |
| POST | `/api/marketplace/orders/prepare` | ✓ | Create order |
| POST | `/api/marketplace/orders/complete` | ✓ | Complete order with tx hash |
| GET | `/api/marketplace/orders/mine` | ✓ | Player's orders |
| POST | `/api/moments/register` | ✓ | Create moment |
| GET | `/api/moments` | — | Public moments feed |
| GET | `/api/moments/my` | ✓ | Player's moments |
| GET | `/api/moments/:id` | — | Single moment |
| GET | `/api/moments/:id/zg-proof` | — | 0G storage proof |
| GET | `/api/moments/:id/da-events` | — | DA event history |
| PATCH | `/api/moments/:id` | ✓ | Update moment |
| DELETE | `/api/moments/:id` | ✓ | Delete moment |
| POST | `/api/moments/:id/like` | ✓ | Like moment |
| POST | `/api/moments/:id/zg/retry` | ✓ | Retry 0G migration |
| POST | `/api/social-media/posts` | ✓ | Submit social post |
| GET | `/api/social-media/posts/my` | ✓ | Player's submitted posts |
| GET | `/api/referral/me` | ✓ | Get or create referral link |
| GET | `/r/:code` | — | Referral redirect |
| POST | `/api/upload/presign` | ✓ | Generate presigned upload URL |
| PUT | `/api/admin/leaderboard-config` | ✓ admin | Upsert leaderboard config |
| PUT | `/api/admin/marketplace/listings` | ✓ admin | Upsert marketplace listing |
| GET | `/health` | — | Health check |

---

## Getting Started

### Prerequisites
- Node.js 20+
- MongoDB
- Redis / Valkey

### Install & run

```bash
# Install dependencies
npm install

# Copy env and fill in your values
cp .env.example .env

# Development (hot reload)
npm run dev

# Production build
npm run build
npm start
```

### Environment

Copy `.env.example` to `.env`. The minimum required vars for local development:

```env
HOST=0.0.0.0
PORT=4000
JWT_SECRET=your-local-secret
MONGO_URI=mongodb://localhost:27017/
MONGO_DB_NAME=kult_browser
VALKEY_URL=redis://127.0.0.1:6379

# Optional — workers will skip gracefully if not set
DO_SPACES_KEY=
DO_SPACES_SECRET=
MOMENTS_DO_SPACES_BUCKET=
BD_API_KEY=
ZG_PRIVATE_KEY=
ZG_DA_DISPERSER_URL=
ZG_COMPUTE_PROVIDER_URL=
ZG_COMPUTE_API_KEY=
```

---

## Background Workers

Workers start automatically with the server and stop gracefully on `SIGTERM`/`SIGINT`.

| Worker | Trigger | What it does |
|---|---|---|
| `MigrationWorker` | Queue (`BRPOPLPUSH`) | Downloads moment asset from DO Spaces, uploads to 0G Storage |
| `ScrapeWorker` | Queue (`BRPOPLPUSH`) | Scrapes submitted social posts via Bright Data, marks validated/rejected |
| `DaEventWorker` | Polling (10s) | Disperses moment events to 0G DA layer |
| `ComputeWorker` | Polling (15s) | Runs AI analysis on new moments via 0G Compute |
| `OnchainWorker` | Polling (configurable) | Submits activity jobs to EVM contract |

Workers that depend on unconfigured external services skip silently on startup — the rest of the app continues working.

---

## Reliable Queue Pattern

`ValkyQueue` implements at-least-once delivery using Redis:

```
Producer  → LPUSH  queue            (enqueue)
Worker    → BRPOPLPUSH queue :processing  (atomic pop to in-flight list)
Worker    → process job
Worker    → LREM  :processing 1 raw  (ack — removes from in-flight)

On failure → LREM  :processing 1 raw
           → LPUSH queue (retry) or LPUSH DLQ (max retries exceeded)
```

This guarantees no job is silently dropped if the worker crashes mid-processing.

---

## Docker

```bash
docker build -t kult-browser-backend-v2 .
docker run -p 4000:4000 --env-file .env kult-browser-backend-v2
```

The Dockerfile uses a multi-stage build: `builder` compiles TypeScript, `runtime` runs the compiled JS with production deps only.
