// src/config.ts
// Single source of truth for all environment configuration.
import dotenv from 'dotenv';
dotenv.config();

const e = (key: string, fallback?: string): string => {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${key}`);
  return v;
};

const eOpt = (key: string, fallback?: string): string | undefined => process.env[key] ?? fallback;
const eInt  = (key: string, d: number) => parseInt(process.env[key] ?? String(d), 10);
const eBool = (key: string, d: boolean) => (process.env[key] === undefined ? d : process.env[key] === 'true');
const eList = (key: string, d: string[]) => (process.env[key] ? process.env[key]!.split(',').map((s) => s.trim()) : d);

export const config = {
  app: {
    host:        e('HOST',        '0.0.0.0'),
    port:        eInt('PORT',     4000),
    name:        e('APP_NAME',   'kult-browser-backend'),
    corsOrigins: eList('CORS_ORIGINS', ['*']),
    environment: e('ENVIRONMENT', 'production'),
    isAdmin():   boolean { return this.environment === 'dev'; },
  },

  auth: {
    jwtSecret:       e('JWT_SECRET',         'change-me-before-production'),
    jwtExpiryDays:   eInt('JWT_EXPIRATION_DAYS', 7),
    siweDomain:      e('SIWE_DOMAIN', 'app.kultgames.io'),
    siweUri:         e('SIWE_URI',    'https://app.kultgames.io'),
    siweChainId:     eInt('SIWE_CHAIN_ID', 1),
  },

  accessCodes: {
    issuer: e('ACCESS_CODE_JWT_ISSUER', 'kult-browser-access'),
    sessionExpiryDays: eInt('ACCESS_CODE_SESSION_EXPIRATION_DAYS', 7),
    tiers: {
      tier1: eOpt('ACCESS_CODE_TIER_1_HASH', ''),
      tier2: eOpt('ACCESS_CODE_TIER_2_HASH', ''),
      tier3: eOpt('ACCESS_CODE_TIER_3_HASH', ''),
      tier4: eOpt('ACCESS_CODE_TIER_4_HASH', ''),
      tier5: eOpt('ACCESS_CODE_TIER_5_HASH', ''),
    },
  },

  log: {
    level:  e('LOG_LEVEL',  'info'),
    format: e('LOG_FORMAT', 'pretty'),
  },

  db: {
    mongoUri:     e('MONGO_URI',     'mongodb://localhost:27017/'),
    mongoDbName:  e('MONGO_DB_NAME', 'kult_browser'),
    mongoRetries: eInt('MONGO_CONN_RETRIES', 5),
    // Collection names — override per env
    col: {
      games:             e('GAMES_COLL',                   'kultbrowser_games'),
      content:           e('CONTENT_COLL',                 'kultbrowser_content_configs'),
      chatbot:           e('CHATBOT_COLL',                 'kultbrowser_chatbot_knowledge'),
      players:           e('PLAYERS_COLL',                 'store_players'),
      nonces:            e('PLAYER_NONCES_COLL',           'player_nonces'),
      globalLeaderboard: e('GLOBAL_LEADERBOARD_COLL',      'global_leaderboards'),
      gameLbConfig:      e('GAME_LEADERBOARD_CONFIG_COLL', 'store_games_leaderboards'),
      aiModels:          e('AI_MODELS_COLL',               'ai_models'),
      sharedPosts:       e('SHARED_POSTS_COLL',            'shared_posts'),
      onchainJobs:       e('ONCHAIN_ACTIVITY_JOBS_COLL',   'onchain_activity_jobs'),
      moments:           e('MOMENTS_COLL',                 'moments'),
      momentComments:    e('MOMENT_COMMENTS_COLL',         'moment_comments'),
      momentLikes:       e('MOMENT_LIKES_COLL',            'moment_likes'),
      listings:          e('MARKETPLACE_LISTINGS_COLL',    'marketplace_listings'),
      orders:            e('MARKETPLACE_ORDERS_COLL',      'marketplace_orders'),
      daEvents:          'moment_da_events',
    },
  },

  redis: {
    url:    e('VALKEY_URL',        'redis://127.0.0.1:6379'),
    prefix: e('VALKEY_KEY_PREFIX', 'kult_browser'),
  },

  spaces: {
    key:       e('DO_SPACES_KEY',                   ''),
    secret:    e('DO_SPACES_SECRET',                ''),
    endpoint:  e('DO_SPACES_ENDPOINT',              'https://sfo3.digitaloceanspaces.com'),
    region:    e('DO_SPACES_REGION',                'sfo3'),
    bucket:    e('MOMENTS_DO_SPACES_BUCKET',        ''),
    tmpDir:    e('MOMENTS_DOWNLOAD_TMP_DIR',        '/tmp/moments'),
    presignTtl: eInt('MOMENTS_DO_SPACES_PRESIGNED_EXPIRATION', 300),
    uploadPath: e('MOMENTS_UPLOAD_PATH', 'moments'),
  },

  brightData: {
    apiKey:      e('BD_API_KEY',  ''),
    baseUrl:     e('BD_BASE_URL', 'https://api.brightdata.com'),
    triggerPath: e('BD_TRIGGER_PATH',  '/datasets/v3/trigger'),
    progressPath:e('BD_PROGRESS_PATH', '/datasets/v3/progress'),
    snapshotPath:e('BD_SNAPSHOT_PATH', '/datasets/v3/snapshot'),
    pollInterval:eInt('BD_POLL_INTERVAL', 10),
    pollTimeout: eInt('BD_POLL_TIMEOUT', 180),
    datasets: {
      twitter:   e('BD_DATASET_TWITTER',   'gd_lwxkxvnf1cynvib9co'),
      instagram: e('BD_DATASET_INSTAGRAM', 'gd_lk5ns7kz21pck8jpis'),
      tiktok:    e('BD_DATASET_TIKTOK',    'gd_lu702nij2f790tmv9h'),
      facebook:  e('BD_DATASET_FACEBOOK',  'gd_lyclm1571iy3mv57zw'),
      reddit:    e('BD_DATASET_REDDIT',    'gd_lvz8ah06191smkebj4'),
      linkedin:  e('BD_DATASET_LINKEDIN',  'gd_lyy3tktm25m4avu764'),
      pinterest: e('BD_DATASET_PINTEREST', 'gd_lk0sjs4d21kdr7cnlv'),
    },
  },

  scrape: {
    minAgeHours:     eInt('SCRAPE_MIN_AGE_HOURS',     24),
    maxRetries:      eInt('SCRAPE_MAX_RETRIES',        3),
    validationTerms: eList('SCRAPE_VALIDATION_TERMS', ['game']),
  },

  zg: {
    binaryPath:   eOpt('ZG_BINARY_PATH',     './src/external/0g/0g-storage-client'),
    rpcUrl:       eOpt('ZG_RPC_URL',         'https://evmrpc.0g.ai/'),
    privateKey:   eOpt('ZG_PRIVATE_KEY',     ''),
    indexerUrl:   eOpt('ZG_INDEXER_URL',     'https://indexer-storage-turbo.0g.ai'),
    rpcTimeout:   eOpt('ZG_RPC_TIMEOUT',     '800s'),
    retryCount:   eInt('ZG_RPC_RETRY_COUNT', 5),
    retryInterval:eOpt('ZG_RPC_RETRY_INTERVAL', '3s'),
    gatewayUrl:   e('ZG_GATEWAY_URL',     ''),
    explorerUrl:  e('ZG_EXPLORER_TX_URL', ''),
    daDisperserUrl:    e('ZG_DA_DISPERSER_URL',    ''),
    computeProviderUrl:e('ZG_COMPUTE_PROVIDER_URL',''),
    computeApiKey:     e('ZG_COMPUTE_API_KEY',     ''),
    computeModel:      e('ZG_COMPUTE_MODEL',       'gpt-4o-mini'),
    hasCompute(): boolean { return !!(this.computeProviderUrl && this.computeApiKey); },
    hasUpload(): boolean {
      return !!(this.binaryPath && this.rpcUrl && this.privateKey && this.indexerUrl);
    },
    gatewayUrlFor(hash: string)  { return this.gatewayUrl  ? this.gatewayUrl.replace('{hash}',   hash)   : null; },
    explorerUrlFor(tx: string)   { return this.explorerUrl ? this.explorerUrl.replace('{txHash}', tx)     : null; },
  },

  share: {
    // The SPA's public origin (no trailing slash) — used for redirecting humans from share preview pages.
    publicAppUrl:     e('PUBLIC_APP_URL',      'https://kult-browser-rust-l2lwg.ondigitalocean.app'),
    // The backend's own public origin — used to build share preview URLs.
    shareBaseUrl:     e('SHARE_BASE_URL',       'https://kult-browser-rust-l2lwg.ondigitalocean.app'),
    // Fallback OG image shown when a moment has no asset URL.
    defaultOgImage:   eOpt('SHARE_DEFAULT_OG_IMAGE', ''),
    // App display name shown in meta tags.
    siteName:         e('SHARE_SITE_NAME',      'Kult Moments'),
  },

  onchain: {
    enabled:         eBool('ONCHAIN_ENABLED', false),
    rpcUrl:          e('ONCHAIN_RPC_URL',          'https://evmrpc.0g.ai/'),
    chainId:         eInt('ONCHAIN_CHAIN_ID',       16661),
    contract:        e('ONCHAIN_ACTIVITY_CONTRACT', ''),
    relayerKey:      e('ONCHAIN_RELAYER_PRIVATE_KEY',''),
    confirmations:   eInt('ONCHAIN_CONFIRMATIONS',  1),
    pollSecs:        eInt('ONCHAIN_POLL_INTERVAL_SECS', 5),
    maxRetries:      eInt('ONCHAIN_MAX_RETRIES',    5),
    canSubmit(): boolean { return this.enabled && !!(this.contract && this.relayerKey); },
  },
} as const;

// ── Redis queue key helpers ──────────────────────────────────────────────────
const qk = (...parts: string[]) => [config.redis.prefix, ...parts, 'queue'].join(':');

export const QUEUES = {
  migration:      qk('moments', 'zero_g',      'migration'),
  migrationDlq:   qk('moments', 'zero_g',      'migration') + ':dead_letter',
  scrape:         qk('moments', 'bright_data', 'post_scrape'),
  referralClick:  qk('referral', 'click'),
  referralVerify: qk('referral', 'verification'),
} as const;
