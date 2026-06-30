# Kult Browser Backend (v2)

Node.js / TypeScript / Express backend for the Kult Web3 gaming platform. This is a ground-up
port of the original Rust backend (`kult-browser-backend-rust`), rebuilt with a flat
`model → repository → service → routes` module layout, MongoDB, Redis-backed background
workers, and integrations with DigitalOcean Spaces, Bright Data, 0G Network, and an EVM chain.

> **This document is written for a full handoff.** It covers every endpoint, every background
> process, every external integration, and every environment variable currently in use. If you
> are taking this service over, read this file top to bottom before touching production.

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Project Structure](#project-structure)
3. [Architecture & Design Patterns](#architecture--design-patterns)
4. [Request Lifecycle & Routing Quirks](#request-lifecycle--routing-quirks)
5. [Authentication](#authentication)
6. [API Reference (every endpoint)](#api-reference-every-endpoint)
7. [Background Workers](#background-workers)
8. [Reliable Queue Pattern (Redis)](#reliable-queue-pattern-redis)
9. [External Integrations](#external-integrations)
10. [Data Model / MongoDB Collections](#data-model--mongodb-collections)
11. [Environment Variables (complete reference)](#environment-variables-complete-reference)
12. [Getting Started](#getting-started)
13. [Docker / Deployment](#docker--deployment)
14. [Known Quirks & Operational Notes](#known-quirks--operational-notes)

---

## Tech Stack

| Concern | Choice |
|---|---|
| Language | TypeScript (compiled with `tsc`, run with `ts-node-dev` in dev) |
| HTTP framework | Express 4 |
| Database | MongoDB (native `mongodb` driver, no ODM) |
| Cache / Queue | Redis (Valkey-compatible), via `ioredis` |
| Auth | JWT (`jsonwebtoken`) + Sign-In with Ethereum (SIWE / EIP-4361) |
| Object storage | DigitalOcean Spaces (S3-compatible, `@aws-sdk/client-s3`) |
| Blockchain | `ethers` v6 (EVM read/write for on-chain activity logging) |
| Decentralized storage | 0G Storage (CLI binary wrapper), 0G DA (HTTP disperser), 0G Compute (OpenAI-compatible inference) |
| Social scraping | Bright Data Datasets API (trigger → poll → snapshot) |
| Image processing | `sharp` (OG share-image composition) |
| Logging | `pino` / `pino-http` (pretty in dev, JSON in prod) |
| IDs | `nanoid`, `uuid` |

---

## Project Structure

```
kult-browser-backend-v2/
├── src/
│   ├── index.ts                 # entrypoint: connects DBs, wires factories, starts server + workers
│   ├── app.ts                   # Express app: middleware, routing, legacy-prefix rewriter
│   ├── config.ts                # single source of truth for all env vars
│   ├── core/
│   │   ├── types.ts             # IRepository / BaseRepository / IWorker / AuthPlayer / PaginatedResult<T>
│   │   ├── error.ts             # AppError with 6 factory methods (badRequest, unauthorized, ...)
│   │   └── response.ts          # ok() helper + global errorHandler middleware
│   ├── db/
│   │   ├── mongo.ts             # connectMongo() with retry, ensureIndexes()
│   │   ├── redis.ts             # connectRedis(), getRedis(), ValkyQueue (reliable queue)
│   │   └── logger.ts            # pino logger instance
│   ├── middleware/
│   │   ├── auth.ts              # JWT sign/verify, SIWE message verification, requireAuth, requireAdmin
│   │   └── localization.ts      # Accept-Language → req.locale
│   ├── factory/
│   │   ├── service.factory.ts   # ServiceFactory — singleton-cached construction of every repo/service
│   │   └── worker.factory.ts    # WorkerFactory — builds + starts/stops all background workers
│   ├── external/
│   │   ├── spaces.ts            # DigitalOcean Spaces (S3) client, presigned URLs
│   │   ├── zg-storage.ts        # 0G Storage CLI wrapper (asset migration / upload)
│   │   ├── zg-da.ts             # 0G DA disperser HTTP client
│   │   ├── zg-compute.ts        # 0G Compute client (AI moment analysis)
│   │   └── bright-data.ts       # Bright Data scraping client (per-platform datasets)
│   ├── workers/
│   │   ├── migration.worker.ts  # DO Spaces → 0G Storage asset migration
│   │   ├── scrape.worker.ts     # Bright Data social-post scraping + validation
│   │   ├── da-event.worker.ts   # 0G DA event polling (placeholder — no-op today)
│   │   ├── onchain.worker.ts    # submits on-chain activity records via ethers.js
│   │   └── compute.worker.ts    # runs 0G Compute AI analysis on pending moments
│   └── modules/
│       ├── player/               # SIWE login, nonce issuance, profile
│       ├── agent/                 # auto-generated per-player AI wallet/agent (internal, no routes)
│       ├── game/                  # game catalog
│       ├── content/                # CMS-style content config blobs
│       ├── leaderboard/           # global + per-game leaderboards
│       ├── marketplace/           # listings + orders
│       ├── moments/                # gaming-moment clips: CRUD, likes, bookmarks, comments, watch history
│       ├── social-media/           # social post submission + scrape-queue triggering
│       ├── referral/                # referral codes, click tracking, signup verification
│       ├── onchain/                 # EVM activity job queueing (used by the onchain worker)
│       ├── upload/                  # presigned DO Spaces upload URLs
│       ├── admin/                   # dev-only leaderboard config / marketplace listing writes
│       ├── share/                   # OG/Twitter-Card share preview pages + share images
│       ├── access/                  # shared "access code" verification → tiered JWT
│       ├── kult-points/             # public read-only Kult Points lookups
│       ├── internal-kult-points/    # server-to-server Kult Points read/write (header-key protected)
│       └── player-titles/           # player title/badge lookups
├── scripts/
│   └── hash-access-code.mjs      # CLI to generate ACCESS_CODE_TIER_*_HASH values
├── Dockerfile
├── Procfile
├── .env.example
├── KULT_POINTS.md                 # deep-dive doc on the Kult Points subsystem (data model, levels, ranks)
└── README.md                      # this file
```

Each module under `src/modules/<name>/` generally contains:
- `<name>.model.ts` — TypeScript interfaces for the MongoDB documents + request/response DTOs
- `<name>.repository.ts` — extends `BaseRepository`, owns all MongoDB queries for that module
- `<name>.service.ts` — business logic, calls repositories + external clients
- `<name>.routes.ts` — Express `Router`, thin — parses input, calls service, calls `ok()` / throws `AppError`

---

## Architecture & Design Patterns

- **Layered modules** — strict `routes → service → repository → MongoDB` direction. Routes never
  touch the database directly; services never touch Express `req`/`res`.
- **Factory Method (`ServiceFactory`, `WorkerFactory`)** — all repositories, services, and workers
  are constructed exactly once per process and cached (singleton-per-instance). `app.ts` and
  `index.ts` never call `new XService(...)` directly — everything is built through the factories
  in `src/factory/`. This is the dependency-injection mechanism for this codebase.
- **`BaseRepository` / `IRepository`** — common CRUD scaffolding (`findById`, `create`, etc.) lives
  in `src/core/types.ts`; concrete repositories extend it and add domain-specific queries.
- **`IWorker`** — every background worker implements `start()` / `stop()` so `WorkerFactory.startAll()`
  / `stopAll()` can manage the full set uniformly during boot and graceful shutdown.
- **`AppError` + global `errorHandler`** — services throw `AppError.badRequest(...)`,
  `.unauthorized(...)`, `.forbidden(...)`, `.notFound(...)`, `.conflict(...)`, `.internal(...)`.
  These are the only intentional error type; the global `errorHandler` (registered last in
  `app.ts`) maps them to the right HTTP status + JSON body, and treats anything else as a 500.
- **Reliable Redis queue (`ValkyQueue`)** — see [Reliable Queue Pattern](#reliable-queue-pattern-redis)
  below. Used for asset migration and social-post scraping; not a generic pub/sub.

---

## Request Lifecycle & Routing Quirks

`src/app.ts` builds the Express app. Middleware order matters and has a couple of
non-obvious steps that exist specifically to work around DigitalOcean App Platform's routing
behavior. **Read this section carefully before changing `app.ts` or deployment routing rules.**

### Middleware order (top to bottom)

1. `trust proxy` (1) — required so `req.ip` / rate limiting work correctly behind DO's proxy.
2. CORS — `config.app.corsOrigins` (comma-separated list, defaults to `*`).
3. Rate limiting — 60 requests/minute per IP, standard headers, no legacy headers.
4. `express.json({ limit: '2mb' })`.
5. `pino-http` request logging.
6. `localization` — sets `req.locale` from `Accept-Language` (defaults `en`).
7. **Moment social-share OG handler** (see below) — registered at both `/moments/:momentId` and
   `/:momentId`, **before** the legacy-prefix rewriter.
8. **Legacy-prefix rewriter** — rewrites bare paths to `/api/*`.
9. All module routers (see [API Reference](#api-reference-every-endpoint)).
10. `/share` and `/api/share` (OG preview + share images).
11. `/r/:code` referral redirect.
12. `/health`.
13. Global `errorHandler` (must stay last).

### Why the OG handler is registered before the rewriter

Social platforms (Twitter/X, Discord, Telegram, WhatsApp, Slack, etc.) unfurl links by fetching
the URL server-side and reading `<meta property="og:*">` tags — they don't execute JavaScript.
The frontend SPA serves a moment at `https://<frontend>/#m/:momentId` (a hash route, so the
backend never sees it), but a shareable, crawlable URL needs to be a normal path the crawler's
HTTP client can fetch directly: `/moments/:momentId`.

So `app.ts` registers a handler at `/moments/:momentId` *before* the legacy-prefix rewriter would
otherwise turn that same path into `/api/moments/:momentId` (which only returns moment JSON, not
HTML with OG tags). The handler:
- Inspects `Accept`: if it's `application/json` (an axios/fetch call from the real SPA), it calls
  `next()` and lets the request fall through to the normal JSON moments API.
- Otherwise (a browser or a crawler with `Accept: text/html` or no header), it renders a small
  HTML page with full Open Graph / Twitter Card meta tags, and a `<script>` that
  `window.location.replace()`s human browsers to `/#m/:momentId` on the SPA. Crawlers don't run
  the script, so they just read the meta tags.

The handler is also registered at the bare `/:momentId` path, because DigitalOcean's App
Platform route rules can be configured two different ways:
- **`preserve_path_prefix: true`** → Express receives the full `/moments/:momentId` path.
- **"Path trimmed"** (DO strips the `/moments` prefix before forwarding) → Express only sees
  `/:momentId`.

Both are handled so the share links work regardless of how the DO app spec's route rule for
`/moments` is configured. **If you redeploy this service behind a different routing layer
(nginx, a different PaaS, a new DO app spec), re-verify this — a misconfigured route rule here
silently breaks social link previews while every other endpoint keeps working.**

### Legacy-prefix rewriter

Older clients call bare paths like `/games`, `/marketplace`, `/player` (no `/api` prefix). This
middleware rewrites any request whose path starts with one of:

```
/marketplace /games /content /leaderboard /moments /social-media
/referral /upload /player /admin /access-code /kp /kult-points /player-titles
```

to the same path prefixed with `/api`. It is intentionally a prefix match, so `/games/abc123`
becomes `/api/games/abc123`. Keep this list in sync with `legacyPrefixes` in `app.ts` if you
ever rename a module's mount path.

### Internal Kult Points routing redundancy

The internal (server-to-server) Kult Points router is mounted at **four** different paths:
`/api/internal/kult-points`, `/api/internal/kp`, `/internal/kult-points`, `/internal/kp`. This is
deliberate — DigitalOcean's routing can strip the `/api` prefix before forwarding to this
service depending on how the app spec route rule is written, so the non-`/api` aliases exist as
a safety net for server-to-server callers. The public read-only Kult Points router is similarly
double-mounted at `/api/kp`, `/api/kult-points`, and `/api/internal/kp` (this last one is a
legacy GET-only alias — it does **not** require the internal API key).

---

## Authentication

There are three distinct, independent auth mechanisms in this service. Don't mix them up.

### 1. Player auth — SIWE (Sign-In with Ethereum) → JWT

Used for all player-facing authenticated endpoints (`requireAuth` middleware,
`src/middleware/auth.ts`).

Flow:
1. **`GET /api/player/nonce?walletAddress=0x...`** — server generates and stores a one-time
   nonce for that wallet (`player_nonces` collection), returns it to the client.
2. Client constructs a standard EIP-4361 SIWE message (using `config.auth.siweDomain`,
   `siweUri`, `siweChainId`) embedding that nonce, and signs it with the wallet's private key
   (e.g. via MetaMask/WalletConnect).
3. **`POST /api/player/login`** with `{ walletAddress, message, signature }`. Server:
   - Recovers the signer address from `message` + `signature` (`recoverSigner()`), confirms it
     matches `walletAddress`.
   - Verifies the SIWE message itself (`verifySiweSignature()`) — domain, URI, chain ID, and
     that the nonce embedded in the message matches the stored nonce for that wallet.
   - **Consumes** the nonce (deletes/invalidates it) so the same signed message can't be replayed.
   - If this wallet has never logged in before, creates a player profile record and triggers
     `AgentRepository.createAgentForNewUser()` (generates a random `ethers.Wallet` as that
     player's AI agent wallet — stored in the `ai_models` collection, private key included; see
     [Operational Notes](#known-quirks--operational-notes) for the security implication of that).
   - If a referral code was associated with this signup, queues a referral-signup verification
     job (see [Referral](#referral)).
   - Signs and returns a JWT (`signToken(walletAddress)` — `config.auth.jwtSecret`, expiry
     `config.auth.jwtExpiryDays` days, issuer/audience from config).
4. Client sends `Authorization: Bearer <jwt>` on subsequent requests. `requireAuth` middleware
   verifies the JWT and sets `req.player = { walletAddress }`.

### 2. Access-code auth — shared tiered JWT

A completely separate flow, unrelated to player wallets, used to gate features behind a shared
secret code (e.g. an invite/beta code typed into the app).

- **`POST /api/access-code/verify`** with `{ code }`. The service checks the submitted code
  against 5 configured tier hashes (`ACCESS_CODE_TIER_1_HASH` .. `_5_HASH`, from env). Each
  tier hash can be either:
  - `scrypt$N$r$p$<salt-base64url>$<key-base64url>` (scrypt, timing-safe compare), or
  - `sha256:<hex>` (plain SHA-256, timing-safe compare).
  - Hashes are generated with `npm run hash:access-code` (`scripts/hash-access-code.mjs`).
- On match, returns a JWT with `{ typ: 'kult_access', tier, features }`, signed with the same
  `JWT_SECRET` but a different issuer (`ACCESS_CODE_JWT_ISSUER`) and its own expiry
  (`ACCESS_CODE_SESSION_EXPIRATION_DAYS`, default 7 days).
- Tiers and their unlocked features (hardcoded in `access-code.service.ts`):

  | Tier | Label | Features |
  |---|---|---|
  | `tier_1` | AI Arena + League + Moments | `ai_arena`, `league`, `moments` |
  | `tier_2` | AI Arena + Moments + Games | `ai_arena`, `moments`, `games` |
  | `tier_3` | AI Arena + Games + Creator Platform + Moments | `ai_arena`, `games`, `creator_platform`, `moments` |
  | `tier_4` | Full Browser | `full_browser`, `ai_arena`, `league`, `moments`, `games`, `creator_platform`, `creator_studio` |
  | `tier_5` | Creator Studio | `creator_studio` |

  This token is consumed client-side to gate UI features — there is currently no middleware on
  this backend that *enforces* access-code tiers on other endpoints; it's purely an
  issuance/verification endpoint.

### 3. Internal API key — server-to-server

Used to protect the internal Kult Points write endpoints (`internal-kult-points` module) from
being called by anything other than trusted backend services (e.g. the games themselves
crediting points after a match).

- Caller sends the configured header (default name `x-kult-internal-key`, configurable via
  `INTERNAL_KULT_POINTS_HEADER_NAME`) with value `INTERNAL_KULT_POINTS_API_KEY`.
- Compared with `crypto.timingSafeEqual` (not `===`) to avoid timing side-channel attacks.
- Falls back to legacy env var names `INTERNAL_KP_HEADER_NAME` / `INTERNAL_KP_API_KEY` if the
  new ones aren't set (see `config.ts`).

### `requireAdmin`

A third middleware, `requireAdmin` (also in `auth.ts`), only allows requests through when
`config.app.environment === 'dev'`. It performs **no actual authentication** — it's a hard
environment gate. Routes behind it (`admin.routes.ts`: leaderboard config writes, marketplace
listing writes) are **only reachable in the `dev` environment** as currently implemented. If you
need real admin auth in production, this needs to be built — don't assume `requireAdmin` provides
any protection in `production`/`prod` environments beyond "this route doesn't exist there."

---

## API Reference (every endpoint)

All paths below are shown as mounted (i.e. with `/api` prefix). Every one of these also works
without the `/api` prefix for the prefixes listed in [Legacy-prefix rewriter](#legacy-prefix-rewriter)
(e.g. `/api/games` and `/games` both work; `/api/share` does **not** go through the rewriter, it's
mounted directly at `/share` too — see the Share section).

🔒 = requires `Authorization: Bearer <player JWT>` (`requireAuth`)
🔑 = requires internal API key header
🛠️ = `requireAdmin` (dev environment only)

### Player — `/api/player`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/player/nonce?walletAddress=` | — | Issue a one-time SIWE nonce for a wallet |
| POST | `/api/player/login` | — | Verify SIWE signature, consume nonce, issue JWT (creates profile + AI agent on first login) |
| GET | `/api/player/profile` | 🔒 | Get the authenticated player's profile |
| PATCH | `/api/player/name` | 🔒 | Update the authenticated player's display name |

### Game — `/api/games`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/games` | — | Paginated game list (query params: page, pageSize, category, etc.) |
| GET | `/api/games/all` | — | Full game list, unpaginated |
| GET | `/api/games/categories` | — | Distinct list of game categories |
| GET | `/api/games/:identification` | — | Single game detail by `identification` slug |

### Content — `/api/content`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/content` | — | CMS-style content config blob(s) — generic key/value content used by the frontend |

### Leaderboard — `/api/leaderboard`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/leaderboard/global` | — | Paginated global leaderboard (cross-game, weighted composite score) |
| POST | `/api/leaderboard/refresh` | 🔒 | Recompute the global leaderboard from all per-game leaderboard configs |
| GET | `/api/leaderboard/game/:identification` | — | Paginated per-game leaderboard |

The global leaderboard is a denormalized snapshot (`global_leaderboards` collection), rebuilt by
`refresh`: it pulls every configured game's leaderboard (`store_games_leaderboards` config docs,
each with a `weight`), computes `score * weight` per player per game, sums across games, sorts
descending, and assigns `rank` + a `level` (1/20/40/60/80/100 score-banded tiers — see
`calculateLevel()` in `leaderboard.service.ts`).

### Marketplace — `/api/marketplace`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/marketplace` | — | Paginated listing catalog |
| GET | `/api/marketplace/:id` | — | Single listing detail |
| POST | `/api/marketplace/orders/prepare` | 🔒 | Create a pending order for a listing (reserves it, returns order/payment info) |
| POST | `/api/marketplace/orders/complete` | 🔒 | Mark an order complete (e.g. after on-chain payment confirms; idempotent on duplicate key) |
| GET | `/api/marketplace/orders/mine` | 🔒 | The authenticated player's order history |

`ListingModel`: `name`, `shortDescription`, `longDescription`, `assetUrl`, `price`, `category`,
`currency`, `gameIdentification`, `contractItemId`, `status`. `OrderModel`: `listingId`,
`orderId`, `playerId`, `buyerWallet`, `gameIdentification`, `paymentToken`, `pricePaid`,
`quantity`, `status`, `txHash`.

### Moments — `/api/moments`

The largest module — gaming clip/screenshot sharing with social features, 0G decentralized
storage, and AI analysis.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/moments/register` | 🔒 | Register a new moment (after asset is uploaded to DO Spaces via the presign flow) |
| GET | `/api/moments` | — | Paginated/filterable moment feed |
| GET | `/api/moments/my` | 🔒 | Authenticated player's own moments |
| GET | `/api/moments/bookmarks` | 🔒 | Authenticated player's bookmarked moments |
| GET | `/api/moments/top-creators` | — | Leaderboard of creators ranked by moment engagement |
| GET | `/api/moments/recently-watched` | 🔒 | Authenticated player's watch history |
| GET | `/api/moments/comments/:commentId/replies` | — | Replies to a top-level comment |
| POST | `/api/moments/comments/:commentId/replies` | 🔒 | Reply to a comment |
| PATCH | `/api/moments/comments/:commentId` | 🔒 | Edit own comment/reply |
| DELETE | `/api/moments/comments/:commentId` | 🔒 | Delete own comment/reply (cascades to replies — see Comments below) |
| GET | `/api/moments/default/share-image.jpg` | — | Default/fallback OG share image |
| GET | `/api/moments/:momentId/share-image.jpg` | — | Generated OG share image for a specific moment |
| GET | `/api/moments/:momentId` | — | Single moment detail (JSON — see note below on OG handler precedence) |
| GET | `/api/moments/:momentId/zg-proof` | — | 0G Storage proof info for the moment's migrated asset |
| GET | `/api/moments/:momentId/da-events` | — | 0G DA event history for the moment |
| PATCH | `/api/moments/:momentId` | 🔒 | Edit own moment (title/description/tags etc.) |
| DELETE | `/api/moments/:momentId` | 🔒 | Delete own moment |
| POST | `/api/moments/:momentId/zg/retry` | 🔒 | Manually re-trigger a failed 0G Storage migration |
| POST | `/api/moments/:momentId/like` | 🔒 | Toggle like on a moment |
| GET | `/api/moments/:momentId/bookmark` | 🔒 | Check bookmark status for the authenticated player |
| POST | `/api/moments/:momentId/bookmark` | 🔒 | Toggle bookmark on a moment |
| POST | `/api/moments/:momentId/watch` | 🔒 | Record a watch-history entry |
| GET | `/api/moments/:momentId/comments` | — | Paginated top-level comments on a moment |
| POST | `/api/moments/:momentId/comments` | 🔒 | Post a top-level comment |

> **Note:** `GET /api/moments/:momentId` (JSON) only gets hit for requests that send
> `Accept: application/json` — see [why the OG handler is registered before the rewriter](#why-the-og-handler-is-registered-before-the-rewriter).
> Plain browser navigation to `/moments/:momentId` is intercepted earlier by the OG share
> handler, which renders HTML instead.

Comments support one level of nesting (top-level comment → replies). Deleting a comment soft- or
hard-deletes its replies in cascade (see `comments.service.ts`).

Moment lifecycle: a moment is registered referencing an already-uploaded DO Spaces asset →
`MigrationWorker` migrates the asset from DO Spaces to 0G Storage in the background → once
migrated, `ComputeWorker` (if 0G Compute is configured) runs AI analysis (caption, rank score,
highlights, skill score, rarity) → `OnchainWorker` (if configured) records the moment-creation
activity on-chain.

### Social Media — `/api/moments/social-media` and `/api/social-media` (identical, same router mounted twice)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/social-media/posts` | 🔒 | Submit a social post for scrape-and-validate (queues a scrape job) |
| GET | `/api/social-media/posts/my` | 🔒 | Authenticated player's submitted posts |
| GET | `/api/social-media/my-posts` | 🔒 | Compat alias of the above, shaped for an older frontend client (`toClientPost()` enrichment) |
| POST | `/api/social-media/submit-url` | 🔒 | Compat alias to submit a post by raw URL (older client shape) |
| POST | `/api/social-media/posts/:postId/requeue` | 🔒 | Re-queue a previously failed/stale scrape job |

Supported platforms: `twitter`, `instagram`, `tiktok`, `facebook`, `reddit`, `linkedin`,
`pinterest` — each maps to a Bright Data dataset ID (`config.brightData.datasets.*`). Submitting
a post pushes a job onto the `scrape` Redis queue, consumed by `ScrapeWorker`.

### Referral — `/api/referral`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/referral/me` | 🔒 | Authenticated player's referral code + click/signup stats |
| GET | `/api/referral/:code` | — | Public lookup/validation of a referral code |

Plus, mounted separately at the root (not under `/api`, not behind the legacy rewriter):

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/r/:code` | — | Short-link redirect — records a click (queues onto `referralClick` Redis queue) and redirects to the app |

Referral signup verification (crediting the referrer once the referred player actually logs in)
happens asynchronously via the `referralVerify` Redis queue, triggered from
`player.service.ts` during `login()`.

### Player Titles — `/api/player-titles`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/player-titles/:walletAddress` | — | Title/badge(s) earned by a given wallet |

### Upload — `/api/upload`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/upload/presign` | 🔒 | Generate a presigned DO Spaces PUT URL for direct client-side asset upload |

Clients upload the moment asset (image/video) directly to DigitalOcean Spaces using the
presigned URL, then call `POST /api/moments/register` referencing that asset. The backend never
proxies the binary upload itself.

### Admin — `/api/admin` (🛠️ `requireAdmin` — dev environment only)

| Method | Path | Auth | Description |
|---|---|---|---|
| PUT | `/api/admin/leaderboard-config` | 🛠️ | Upsert a per-game leaderboard config (identification, weight, source) |
| PUT | `/api/admin/marketplace/listings` | 🛠️ | Upsert a marketplace listing |

### Access Code — `/api/access-code`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/access-code/verify` | — | Verify a shared access code, returns a tiered JWT (see [Access-code auth](#2-access-code-auth--shared-tiered-jwt)) |

### Kult Points (public, read-only) — `/api/kp`, `/api/kult-points`, `/api/internal/kp` (legacy GET-only alias)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/kult-points?walletAddress=` | — | Public read of a player's Kult Points balance/level/rank |

### Internal Kult Points (server-to-server) — `/api/internal/kult-points`, `/api/internal/kp`, `/internal/kult-points`, `/internal/kp`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/internal/kult-points?walletAddress=` | 🔑 | Read a player's full Kult Points record |
| POST | `/api/internal/kult-points` | 🔑 | Give/minus points for a wallet (clamped, level/rank recalculated) |

See **`KULT_POINTS.md`** for the full data model, level-tier table, and rank-calculation formula
— it is not duplicated here to avoid drift between two docs. The short version: points are
given/deducted via the internal endpoint above (intended for game services to call after a
match), and the public endpoint exposes a read-only view for the frontend.

### Share / OG preview — mounted at both `/share` and `/api/share`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/share/default-og.jpg`, `/share/default-og` | — | Default OG share image (fallback) |
| GET | `/share/moments/:momentId/og-image.jpg`, `/og-image`, `/share-image.jpg` | — | Composed OG share image for a specific moment (rendered via `sharp`) |
| GET | `/share/moments/:momentId` | — | Bot-friendly HTML page with full OG/Twitter Card meta tags; redirects human browsers to the SPA |

Also see the root-mounted OG handler at `/moments/:momentId` and `/:momentId` described in
[Request Lifecycle & Routing Quirks](#request-lifecycle--routing-quirks) — that one is wired
directly in `app.ts` (not through this router) specifically so it runs before the legacy
rewriter.

Crawler detection is a User-Agent regex match against known bots (Twitterbot,
facebookexternalhit, Discordbot, Slackbot, TelegramBot, WhatsApp, LinkedInBot, Googlebot,
Bingbot, Applebot, Pinterest, Redditbot, etc.) — crawlers get a longer cache (`max-age=60,
stale-while-revalidate=300`), humans get `no-store`.

### Misc

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Liveness check, returns `{ ok: true, service: <app name> }` |

---

## Background Workers

Started together in `index.ts` via `WorkerFactory.startAll()`, stopped together on graceful
shutdown (`stopAll()`). Each is independently enabled/disabled based on config — a worker whose
prerequisites aren't configured simply doesn't start (logged, not an error).

| Worker | Enabled when | What it does |
|---|---|---|
| `MigrationWorker` | `config.zg.hasUpload()` (binary path + RPC URL + private key + indexer URL all set) | Pops jobs from the `migration` queue, downloads the asset from DO Spaces, uploads it to 0G Storage via the CLI binary, updates the moment's `assetZgHash`. On repeated failure, moves the job to the `migrationDlq` (dead-letter) queue after max retries. |
| `ScrapeWorker` | always started (Bright Data key may be empty — calls will just fail per-job) | Pops jobs from the `scrape` queue, calls Bright Data (trigger → poll → snapshot) for the relevant platform, validates the scraped content against `config.scrape.validationTerms`, updates the social post's `validation_status`. |
| `DaEventWorker` | `ZG_DA_DISPERSER_URL` is set | **Placeholder.** Polls every 10s, but `processBatch()` currently only logs at debug level — there is no real DA event-processing logic implemented yet. If you're picking this up, this is unfinished work, not a bug. |
| `OnchainActivityWorker` | `config.onchain.canSubmit()` (enabled + contract address + relayer private key set) | Polls pending `onchain_activity_jobs`, submits `recordActivity(...)` transactions to the configured EVM contract via `ethers.js`, waits for `config.onchain.confirmations` confirmations, retries up to `maxRetries`. |
| `ComputeWorker` | `config.zg.hasCompute()` (provider URL + API key set) | Every 15s, picks up to 5 moments pending AI analysis, calls 0G Compute (OpenAI-compatible chat completion) with a gaming-moment-analyst system prompt, parses JSON response (caption, rankScore, highlights, momentType, skillScore, reactionQuality, rarity), writes it back onto the moment. |

`WorkerFactory` uses `require()` (not `import`) for `DaEventWorker` specifically to avoid a
circular dependency — this is intentional, not an oversight, if you see it in the diff.

---

## Reliable Queue Pattern (Redis)

`src/db/redis.ts` implements `ValkyQueue`, used for migration and scrape jobs (not referral
queues, which are simpler fire-and-forget lists). Pattern:

```
producer:  LPUSH <queue>            (push job JSON)

consumer:  BRPOPLPUSH <queue> <queue>:processing   (atomically move job to a processing list, blocking pop)
           ... do the work ...
           on success:  LREM <queue>:processing  (ack — remove from processing list)
           on failure:  LPUSH <queue or queue:dead_letter> (nack — requeue or move to DLQ after max attempts)

recovery:  recoverStalledJobs() — on worker startup, anything left in `<queue>:processing`
           from a previous crashed run is moved back onto the main queue.
```

This guarantees at-least-once processing: a job is only removed from the processing list after
the consumer confirms success: a crash mid-processing leaves it in `:processing`, where the next
`recoverStalledJobs()` run picks it back up.

Queue keys (see `config.ts` `QUEUES`, all prefixed with `config.redis.prefix`, default
`kult_browser`):

| Queue | Key | Used by |
|---|---|---|
| Migration | `kult_browser:moments:zero_g:migration:queue` | `MigrationWorker` |
| Migration DLQ | `...migration:queue:dead_letter` | dead jobs after max retries |
| Scrape | `kult_browser:moments:bright_data:post_scrape:queue` | `ScrapeWorker` |
| Referral click | `kult_browser:referral:click:queue` | `/r/:code` redirect handler |
| Referral verify | `kult_browser:referral:verification:queue` | player login (referral signup credit) |

---

## External Integrations

### DigitalOcean Spaces (`src/external/spaces.ts`)
S3-compatible object storage for raw moment assets (images/video) before/instead-of 0G Storage
migration. Provides: `publicUrlForKey()`, `generatePresignedUploadUrl()` (used by
`/api/upload/presign`), `fileExists()`, `extractSpacesKey()` (handles both virtual-hosted-style
and path-style URLs), and `assertTrustedSpacesUrl()` — a security check used by
`MigrationWorker` to make sure it only ever downloads from the configured bucket/endpoint before
shelling out to the 0G upload binary.

### 0G Storage (`src/external/zg-storage.ts`)
Wraps the `0g-storage-client` CLI binary (`config.zg.binaryPath`) via `execFileSync` — **not** a
shell (`shell: false`), and the file path is validated to be inside `config.spaces.tmpDir` and a
real, non-symlink file before being passed to the binary, to avoid path traversal /
argument-injection issues. Parses `rootHash` and `txHash` out of the CLI's stdout/stderr via
regex. 15-minute execution timeout.

### 0G DA — Data Availability (`src/external/zg-da.ts`)
HTTP client for a 0G DA disperser (`disperseBlob`, `getBlobStatus`, `waitForFinalization`).
**Currently unused in practice** — `DaEventWorker`, the only consumer, is a no-op placeholder
(see Background Workers above). The client itself is implemented and functional if/when that
worker gets built out.

### 0G Compute (`src/external/zg-compute.ts`)
OpenAI-compatible chat-completions client (`config.zg.computeProviderUrl` +
`computeApiKey`, model defaults to `gpt-4o-mini` via `computeModel`). Sends a fixed system prompt
describing Kult's games (guess-the-ai, highway-hustle, ai-arena, kult-royale) and asks for a
structured JSON moment analysis. Used by `ComputeWorker`.

### Bright Data (`src/external/bright-data.ts`)
Datasets API trigger → poll → snapshot pattern for scraping public social posts. One dataset ID
per platform (twitter/instagram/tiktok/facebook/reddit/linkedin/pinterest), configured via env.
`scrapeByPlatform(platform, urls)` dispatches to the right dataset. Used by `ScrapeWorker`.

### Onchain (ethers.js, `src/modules/onchain/`)
`OnchainActivityService.recordActivity()` queues a job (`onchain_activity_jobs` collection) with
a `metadataHash` (`0x` + sha256 of JSON-stringified metadata — not the raw metadata itself, to
keep on-chain calldata small). `OnchainActivityWorker` later submits these via `ethers.js` to
`config.onchain.contract` using `config.onchain.relayerKey` as the signer.

---

## Data Model / MongoDB Collections

All collection names are configurable via env (see `config.ts` → `db.col`), defaults shown:

| Collection (default name) | Module | Notes |
|---|---|---|
| `kultbrowser_games` | game | |
| `kultbrowser_content_configs` | content | |
| `kultbrowser_chatbot_knowledge` | (chatbot — legacy/unused by current routes) | |
| `store_players` | player | |
| `player_nonces` | player | SIWE nonces, short-lived |
| `global_leaderboards` | leaderboard | denormalized, rebuilt by `/leaderboard/refresh` |
| `store_games_leaderboards` | leaderboard | per-game leaderboard config (weight, source) |
| `kult_points` | kult-points / internal-kult-points | see `KULT_POINTS.md` |
| `ai_models` | agent | per-player AI agent wallet — **stores a raw private key, see operational notes** |
| `shared_posts` | social-media | |
| `onchain_activity_jobs` | onchain | |
| `moments` | moments | |
| `moment_comments` | moments | top-level + replies |
| `moment_likes` | moments | |
| `moment_bookmarks` | moments | |
| `moment_watch_history` | moments | |
| `marketplace_listings` | marketplace | |
| `marketplace_orders` | marketplace | |
| `moment_da_events` | moments / 0G DA | name not env-overridable (hardcoded) |
| `player_titles` | player-titles | |

Indexes are created on boot via `ensureIndexes()` in `src/db/mongo.ts` — check that file directly
for the exact index definitions per collection (unique constraints, compound indexes for feed
queries, etc.) rather than relying on this table, since indexes change more often than the
collection list itself.

---

## Environment Variables (complete reference)

All variables are read once in `src/config.ts` at boot. `.env.example` in this repo has the full
list with example/default values — copy it to `.env` to get started. Grouped reference:

### Server
| Var | Default | Notes |
|---|---|---|
| `HOST` | `0.0.0.0` | |
| `PORT` | `4000` | **See [Docker discrepancy note](#known-quirks--operational-notes)** |
| `APP_NAME` | `kult-browser-backend` | used in `/health` response and `JWT_ISSUER` default |
| `CORS_ORIGINS` | `*` | comma-separated list of allowed origins |
| `ENVIRONMENT` | `production` | set to `dev` to unlock `requireAdmin` routes |

### Auth / JWT / SIWE
| Var | Default | Notes |
|---|---|---|
| `JWT_SECRET` | — (required, min 32 chars) | shared by player JWTs and access-code JWTs |
| `JWT_EXPIRATION_DAYS` | `7` | |
| `JWT_ISSUER` | `kult-browser-backend` | |
| `JWT_AUDIENCE` | `kult-browser-clients` | |
| `SIWE_DOMAIN` | `app.kultgames.io` | must match the domain in the signed SIWE message |
| `SIWE_URI` | `https://app.kultgames.io` | |
| `SIWE_CHAIN_ID` | `1` | |

### Access Codes
| Var | Default | Notes |
|---|---|---|
| `ACCESS_CODE_JWT_ISSUER` | `kult-browser-access` | |
| `ACCESS_CODE_SESSION_EXPIRATION_DAYS` | `7` | |
| `ACCESS_CODE_TIER_1_HASH` .. `_5_HASH` | empty | generate with `npm run hash:access-code` |

### Internal Kult Points
| Var | Default | Notes |
|---|---|---|
| `INTERNAL_KULT_POINTS_HEADER_NAME` (falls back to `INTERNAL_KP_HEADER_NAME`) | `x-kult-internal-key` | |
| `INTERNAL_KULT_POINTS_API_KEY` (falls back to `INTERNAL_KP_API_KEY`) | empty | |

### Logging
| Var | Default |
|---|---|
| `LOG_LEVEL` | `info` |
| `LOG_FORMAT` | `pretty` (use `json` in prod) |

### MongoDB
| Var | Default |
|---|---|
| `MONGO_URI` | `mongodb://localhost:27017/` |
| `MONGO_DB_NAME` | `kult_browser` |
| `MONGO_CONN_RETRIES` | `5` |
| `GAMES_COLL`, `CONTENT_COLL`, `CHATBOT_COLL`, `PLAYERS_COLL`, `PLAYER_NONCES_COLL`, `GLOBAL_LEADERBOARD_COLL`, `KULT_POINTS_COLL`, `GAME_LEADERBOARD_CONFIG_COLL`, `AI_MODELS_COLL`, `SHARED_POSTS_COLL`, `ONCHAIN_ACTIVITY_JOBS_COLL`, `MOMENTS_COLL`, `MOMENT_COMMENTS_COLL`, `MOMENT_LIKES_COLL`, `MOMENT_BOOKMARKS_COLL`, `MOMENT_WATCH_HISTORY_COLL`, `MARKETPLACE_LISTINGS_COLL`, `MARKETPLACE_ORDERS_COLL`, `PLAYER_TITLES_COLL` | see [collection table](#data-model--mongodb-collections) for defaults |

### Redis / Valkey
| Var | Default |
|---|---|
| `VALKEY_URL` | `redis://127.0.0.1:6379` |
| `VALKEY_KEY_PREFIX` | `kult_browser` |

### DigitalOcean Spaces
| Var | Default |
|---|---|
| `DO_SPACES_KEY` / `DO_SPACES_SECRET` | empty — required for upload/migration to work |
| `DO_SPACES_ENDPOINT` | `https://sfo3.digitaloceanspaces.com` |
| `DO_SPACES_REGION` | `sfo3` |
| `MOMENTS_DO_SPACES_BUCKET` | empty |
| `MOMENTS_DOWNLOAD_TMP_DIR` | `/tmp/moments` |
| `MOMENTS_MAX_DOWNLOAD_BYTES` | `52428800` (50MB) |
| `MOMENTS_DO_SPACES_PRESIGNED_EXPIRATION` | `300` (seconds) |
| `MOMENTS_UPLOAD_PATH` | `moments` |

### Bright Data
| Var | Default |
|---|---|
| `BD_API_KEY` | empty |
| `BD_BASE_URL` | `https://api.brightdata.com` |
| `BD_TRIGGER_PATH` | `/datasets/v3/trigger` |
| `BD_PROGRESS_PATH` | `/datasets/v3/progress` |
| `BD_SNAPSHOT_PATH` | `/datasets/v3/snapshot` |
| `BD_POLL_INTERVAL` | `10` (seconds) |
| `BD_POLL_TIMEOUT` | `180` (seconds) |
| `BD_DATASET_TWITTER`, `_INSTAGRAM`, `_TIKTOK`, `_FACEBOOK`, `_REDDIT`, `_LINKEDIN`, `_PINTEREST` | pre-filled dataset IDs |

### Scrape Worker
| Var | Default |
|---|---|
| `SCRAPE_MIN_AGE_HOURS` | `24` |
| `SCRAPE_MAX_RETRIES` | `3` |
| `SCRAPE_VALIDATION_TERMS` | `game` (comma-separated; scraped content must contain at least one) |

### 0G Network
| Var | Default | Notes |
|---|---|---|
| `ZG_BINARY_PATH` | `./src/external/0g/0g-storage-client` | must exist + be executable on the host |
| `ZG_RPC_URL` | `https://evmrpc.0g.ai/` | |
| `ZG_PRIVATE_KEY` | empty | wallet that pays for 0G Storage uploads |
| `ZG_INDEXER_URL` | `https://indexer-storage-turbo.0g.ai` | |
| `ZG_RPC_TIMEOUT` | `800s` | |
| `ZG_RPC_RETRY_COUNT` | `5` | |
| `ZG_RPC_RETRY_INTERVAL` | `3s` | |
| `ZG_GATEWAY_URL` | empty (required) | template with `{hash}` placeholder |
| `ZG_EXPLORER_TX_URL` | empty (required) | template with `{txHash}` placeholder |
| `ZG_DA_DISPERSER_URL` | empty | enables `DaEventWorker` (placeholder logic, see above) |
| `ZG_COMPUTE_PROVIDER_URL` | empty | enables `ComputeWorker` together with the key below |
| `ZG_COMPUTE_API_KEY` | empty | |
| `ZG_COMPUTE_MODEL` | `gpt-4o-mini` | |

### Share / OG Preview
| Var | Default | Notes |
|---|---|---|
| `PUBLIC_APP_URL` | empty (required) | the frontend SPA's public origin, no trailing slash |
| `SHARE_BASE_URL` | empty (required) | this backend's own public origin, used to build absolute OG image URLs |
| `SHARE_DEFAULT_OG_IMAGE` | empty | fallback image when a moment has no asset |
| `SHARE_SITE_NAME` | `Kult Moments` | shown in `og:site_name` |

### Onchain
| Var | Default | Notes |
|---|---|---|
| `ONCHAIN_ENABLED` | `false` | master switch |
| `ONCHAIN_RPC_URL` | `https://evmrpc.0g.ai/` | |
| `ONCHAIN_CHAIN_ID` | `16661` | |
| `ONCHAIN_ACTIVITY_CONTRACT` | empty | contract address, required to enable submission |
| `ONCHAIN_RELAYER_PRIVATE_KEY` | empty | **hot wallet that pays gas — treat as a production secret** |
| `ONCHAIN_CONFIRMATIONS` | `1` | |
| `ONCHAIN_POLL_INTERVAL_SECS` | `5` | |
| `ONCHAIN_MAX_RETRIES` | `5` | |

> Never commit real values for `JWT_SECRET`, `ZG_PRIVATE_KEY`, `ACCESS_CODE_TIER_*_HASH`,
> `INTERNAL_KULT_POINTS_API_KEY`, `DO_SPACES_KEY`/`SECRET`, `BD_API_KEY`, or
> `ONCHAIN_RELAYER_PRIVATE_KEY` to source control. `.env.example` documents formats/shapes only.

---

## Getting Started

```bash
npm install
cp .env.example .env        # fill in real values — at minimum MONGO_URI, VALKEY_URL, JWT_SECRET
npm run dev                  # ts-node-dev, restarts on file change
```

Other scripts:

```bash
npm run build                # tsc -> dist/
npm start                    # node dist/index.js (run build first)
npm run lint
npm run typecheck
npm test                     # build + node --test
npm run hash:access-code     # generates ACCESS_CODE_TIER_*_HASH values from a plaintext code
```

Boot sequence (`src/index.ts`): connect MongoDB (with retry) → connect Redis → `ensureIndexes()`
→ build `ServiceFactory` → build `WorkerFactory` → `createApp(services)` → `workers.startAll()`
→ start HTTP server → register `SIGTERM`/`SIGINT` handlers for graceful shutdown (stops workers,
closes the HTTP server, then force-exits after a 10s timeout if anything hangs).

---

## Docker / Deployment

- `Dockerfile` is a multi-stage build, final image runs as a non-root `appuser`.
- `Procfile`: `web: node dist/index.js` — for Heroku-style / DO App Platform process management.
- The app reads `PORT` from env at runtime (default `4000` if unset) — whatever you set
  `PORT` to in the deployment environment is what the server actually binds to.

### DigitalOcean App Platform routing

If redeploying behind DO App Platform (or replicating this setup elsewhere), the route rules
need to send:
- `/api/*` → this service.
- `/moments/*` → this service, with **`preserve_path_prefix: true`** (not "Path trimmed") so the
  share-preview OG handler in `app.ts` receives the full path. See
  [Request Lifecycle & Routing Quirks](#request-lifecycle--routing-quirks) for why this matters
  and what happens if it's misconfigured (social link previews silently break while everything
  else keeps working).
- Everything else (the SPA's static assets, all other paths) → the frontend static site,
  registered as a lower-priority catch-all than the two rules above.

---

## Known Quirks & Operational Notes

Flagging these explicitly for whoever takes this service over — none of them are blocking, but
all are worth knowing before you change deployment config or touch the relevant code.

1. **`Dockerfile` `EXPOSE 8080` vs. app default `PORT=4000`.** The Dockerfile documents port
   `8080`, but the app's own default (`config.ts`) is `4000`. In practice the actual bound port
   is whatever `PORT` env var is set to at runtime — `EXPOSE` is documentation only and doesn't
   affect binding — but if you're configuring a new deployment's health-check port or container
   port mapping from the Dockerfile alone, this discrepancy will bite you. Set `PORT` explicitly
   in your deployment environment and make sure the platform's expected port matches it.

2. **`DaEventWorker` is a placeholder.** It's wired up, conditionally starts when
   `ZG_DA_DISPERSER_URL` is set, and polls every 10 seconds — but `processBatch()` does not
   actually do anything beyond a debug log line. The 0G DA HTTP client (`zg-da.ts`) itself is
   fully implemented and ready to use; the worker logic that would actually consume it has not
   been written. Don't assume DA events are being processed in production just because the
   worker "starts."

3. **`requireAdmin` is an environment gate, not authentication.** Routes behind it
   (`/api/admin/*`) are reachable by anyone when `ENVIRONMENT=dev`, and unreachable (404, since
   the middleware just calls `next(AppError.notFound(...))` for non-dev) otherwise. There is no
   admin login/role system. If admin functionality needs to exist in production, this needs to
   be designed from scratch.

4. **Per-player AI agent wallets store a raw private key in MongoDB** (`ai_models` collection,
   `AgentRepository.createAgentForNewUser()` — `ethers.Wallet.createRandom()`, then
   `privateKey` is written to the document as-is). This is functional but means anyone with read
   access to that collection (or a DB backup) has custody of every player's agent wallet. Worth
   flagging to whoever owns this system long-term — encrypting that field at rest, or moving key
   custody to a KMS/HSM, would be a meaningful hardening step if these wallets ever hold real
   value.

5. **The internal Kult Points router is mounted on 4 different paths**, and the public read-only
   router is mounted on 3, with one overlapping path (`/api/internal/kp`) serving the *public*
   (read-only, no key required) handler rather than the internal one — this is intentional
   (see [Internal Kult Points routing redundancy](#internal-kult-points-routing-redundancy)) but
   easy to misread as a bug at a glance. If you ever need to actually remove one of these
   aliases, audit live traffic to that path first.

6. **For the full Kult Points data model** (level tiers, rank formula, give/minus clamping
   logic, repository method reference), see `KULT_POINTS.md` in this same directory — it was
   kept as a focused standalone doc rather than folded into this README to avoid duplication
   drift between the two.
