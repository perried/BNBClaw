-- BNBClaw Database Schema

-- Track all trades
CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    direction TEXT NOT NULL,        -- 'LONG' | 'SHORT'
    entry_price REAL NOT NULL,
    exit_price REAL,
    size_bnb REAL NOT NULL,
    pnl_usdt REAL,
    pnl_action TEXT,               -- 'BUY_BNB' | 'KEEP_USDT'
    status TEXT NOT NULL            -- 'OPEN' | 'CLOSED'
);

-- Track reward distributions
CREATE TABLE IF NOT EXISTS rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,           -- 'LAUNCHPOOL' | 'AIRDROP' | 'EARN_INTEREST' | 'DISTRIBUTION'
    asset TEXT NOT NULL,
    amount REAL NOT NULL,
    tran_id INTEGER UNIQUE,        -- Binance tranId for dedup
    converted_to TEXT,             -- 'USDT' | null
    converted_amount REAL
);

-- Track BNB balance over time
CREATE TABLE IF NOT EXISTS bnb_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    earn_balance REAL NOT NULL,
    spot_balance REAL NOT NULL,
    total REAL NOT NULL
);

-- Track USDT balance over time
CREATE TABLE IF NOT EXISTS usdt_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    futures_balance REAL NOT NULL,
    spot_balance REAL NOT NULL,
    total REAL NOT NULL
);

-- User settings
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Short profit accumulation buffer
CREATE TABLE IF NOT EXISTS accumulator (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    short_profit_buffer REAL NOT NULL DEFAULT 0
);

-- Initialize accumulator row
INSERT OR IGNORE INTO accumulator (id, short_profit_buffer) VALUES (1, 0);

-- Scheduled jobs (Megadrop, timed events)
CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name TEXT NOT NULL,
    action TEXT NOT NULL,
    execute_at TEXT NOT NULL,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TEXT NOT NULL,
    executed_at TEXT
);
