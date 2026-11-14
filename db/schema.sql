-- MUSD Rescue schema. Idempotent: safe to run repeatedly (npm run db:migrate).
-- Everything lives in the dedicated `rescue` schema; nothing touches `public` or other schemas.
CREATE SCHEMA IF NOT EXISTS rescue;

-- SIWE nonces: server-issued, single use, short expiry.
CREATE TABLE IF NOT EXISTS rescue.siwe_nonces (
  nonce        TEXT PRIMARY KEY,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS siwe_nonces_expires_idx ON rescue.siwe_nonces (expires_at);

-- Users are wallet addresses (lower-case). prefs holds risk-category thresholds and display options.
CREATE TABLE IF NOT EXISTS rescue.users (
  address      TEXT PRIMARY KEY CHECK (address ~ '^0x[0-9a-f]{40}$'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  prefs        JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Positions a user follows: their own trove plus read-only watched addresses.
CREATE TABLE IF NOT EXISTS rescue.watchlist (
  user_address TEXT NOT NULL REFERENCES rescue.users(address) ON DELETE CASCADE,
  trove_owner  TEXT NOT NULL CHECK (trove_owner ~ '^0x[0-9a-f]{40}$'),
  label        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_address, trove_owner)
);

-- Alert rules (per user and position).
CREATE TABLE IF NOT EXISTS rescue.alert_rules (
  id             BIGSERIAL PRIMARY KEY,
  user_address   TEXT NOT NULL REFERENCES rescue.users(address) ON DELETE CASCADE,
  trove_owner    TEXT NOT NULL CHECK (trove_owner ~ '^0x[0-9a-f]{40}$'),
  kind           TEXT NOT NULL CHECK (kind IN ('enters_warning','enters_critical','hf_drop','price_drop','debt_increase','data_stale','recovery_mode')),
  threshold      NUMERIC,
  frequency      TEXT NOT NULL DEFAULT 'once_per_day' CHECK (frequency IN ('every_check','once_per_hour','once_per_day')),
  channel        TEXT NOT NULL DEFAULT 'in_app' CHECK (channel IN ('in_app','in_app_browser')),
  quiet_start    SMALLINT CHECK (quiet_start BETWEEN 0 AND 23),
  quiet_end      SMALLINT CHECK (quiet_end BETWEEN 0 AND 23),
  tz_offset_min  INTEGER NOT NULL DEFAULT 0 CHECK (tz_offset_min BETWEEN -840 AND 840),
  enabled        BOOLEAN NOT NULL DEFAULT true,
  baseline       JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_evaluated_at TIMESTAMPTZ,
  last_triggered_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS alert_rules_user_idx ON rescue.alert_rules (user_address);
CREATE INDEX IF NOT EXISTS alert_rules_owner_idx ON rescue.alert_rules (trove_owner);

-- In-app notifications produced by alert evaluation.
CREATE TABLE IF NOT EXISTS rescue.notifications (
  id           BIGSERIAL PRIMARY KEY,
  user_address TEXT NOT NULL REFERENCES rescue.users(address) ON DELETE CASCADE,
  rule_id      BIGINT REFERENCES rescue.alert_rules(id) ON DELETE SET NULL,
  trove_owner  TEXT,
  severity     TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  quiet        BOOLEAN NOT NULL DEFAULT false,
  source       TEXT NOT NULL CHECK (source IN ('cron','visit','check_now')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON rescue.notifications (user_address, created_at DESC);

-- On-chain oracle observations (PriceFeed keeps no history, so the app records it).
CREATE TABLE IF NOT EXISTS rescue.oracle_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  network       TEXT NOT NULL DEFAULT 'testnet',
  block_number  BIGINT NOT NULL,
  block_time    TIMESTAMPTZ NOT NULL,
  price         NUMERIC(78,0) NOT NULL,
  tcr           NUMERIC(78,0) NOT NULL,
  recovery_mode BOOLEAN NOT NULL,
  system_coll   NUMERIC(78,0) NOT NULL,
  system_debt   NUMERIC(78,0) NOT NULL,
  trove_count   INTEGER NOT NULL,
  source        TEXT NOT NULL CHECK (source IN ('cron','visit','check_now','tx')),
  observed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (network, block_number)
);
CREATE INDEX IF NOT EXISTS oracle_snapshots_time_idx ON rescue.oracle_snapshots (network, block_time DESC);

-- Per-trove observations for the health-factor history chart.
CREATE TABLE IF NOT EXISTS rescue.trove_snapshots (
  id            BIGSERIAL PRIMARY KEY,
  network       TEXT NOT NULL DEFAULT 'testnet',
  trove_owner   TEXT NOT NULL,
  block_number  BIGINT NOT NULL,
  block_time    TIMESTAMPTZ NOT NULL,
  status        SMALLINT NOT NULL,
  coll          NUMERIC(78,0) NOT NULL,
  principal     NUMERIC(78,0) NOT NULL,
  interest      NUMERIC(78,0) NOT NULL,
  price         NUMERIC(78,0) NOT NULL,
  icr           NUMERIC(78,0),
  source        TEXT NOT NULL CHECK (source IN ('cron','visit','check_now','tx')),
  observed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (network, trove_owner, block_number)
);
CREATE INDEX IF NOT EXISTS trove_snapshots_owner_idx ON rescue.trove_snapshots (network, trove_owner, block_time DESC);

-- Rescue transactions, recorded only after server-side receipt verification. UNIQUE tx_hash: no double counting.
CREATE TABLE IF NOT EXISTS rescue.rescue_txs (
  id             BIGSERIAL PRIMARY KEY,
  tx_hash        TEXT NOT NULL UNIQUE CHECK (tx_hash ~ '^0x[0-9a-f]{64}$'),
  network        TEXT NOT NULL DEFAULT 'testnet',
  user_address   TEXT NOT NULL,
  trove_owner    TEXT NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('repay','add_collateral','repay_and_add')),
  repay_amount   NUMERIC(78,0) NOT NULL DEFAULT 0,
  coll_amount    NUMERIC(78,0) NOT NULL DEFAULT 0,
  status         TEXT NOT NULL CHECK (status IN ('confirmed','reverted')),
  block_number   BIGINT NOT NULL,
  gas_used       NUMERIC(78,0),
  icr_before     NUMERIC(78,0),
  icr_after      NUMERIC(78,0),
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  verified_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rescue_txs_owner_idx ON rescue.rescue_txs (trove_owner, verified_at DESC);

-- Activity feed: on-chain (verified) and off-chain (application) events, separated by `category`.
CREATE TABLE IF NOT EXISTS rescue.activity (
  id            BIGSERIAL PRIMARY KEY,
  user_address  TEXT,
  trove_owner   TEXT,
  category      TEXT NOT NULL CHECK (category IN ('onchain','offchain')),
  kind          TEXT NOT NULL CHECK (kind IN ('position_discovered','threshold_crossed','alert_triggered','simulation_completed','tx_prepared','tx_submitted','tx_confirmed','tx_failed','tx_rejected')),
  title         TEXT NOT NULL,
  tx_hash       TEXT,
  details       JSONB NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key TEXT UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_user_idx ON rescue.activity (user_address, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_owner_idx ON rescue.activity (trove_owner, created_at DESC);

-- Monitoring runs, so the UI can state the last successful monitoring time honestly.
CREATE TABLE IF NOT EXISTS rescue.monitor_runs (
  id              BIGSERIAL PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('cron','visit','check_now')),
  user_address    TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  ok              BOOLEAN,
  troves_checked  INTEGER NOT NULL DEFAULT 0,
  rules_evaluated INTEGER NOT NULL DEFAULT 0,
  alerts_fired    INTEGER NOT NULL DEFAULT 0,
  block_number    BIGINT,
  error           TEXT
);
CREATE INDEX IF NOT EXISTS monitor_runs_time_idx ON rescue.monitor_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS monitor_runs_user_idx ON rescue.monitor_runs (user_address, started_at DESC);
