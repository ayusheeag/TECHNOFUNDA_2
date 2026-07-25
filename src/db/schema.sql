-- Schema for the US stock screener.
-- Raw data (prices, fundamentals) is stored append/upsert; analysis is computed on read.

-- Reference list of tickers and their classification.
CREATE TABLE IF NOT EXISTS tickers (
    symbol        TEXT PRIMARY KEY,
    name          TEXT,
    exchange      TEXT,
    sector        TEXT,
    industry      TEXT,
    market_cap    REAL,
    is_active     INTEGER DEFAULT 1,
    updated_at    TEXT
);

-- Daily OHLCV bars. One row per (symbol, date).
CREATE TABLE IF NOT EXISTS daily_bars (
    symbol   TEXT NOT NULL,
    date     TEXT NOT NULL,       -- ISO 'YYYY-MM-DD'
    open     REAL,
    high     REAL,
    low      REAL,
    close    REAL,
    volume   REAL,
    PRIMARY KEY (symbol, date)
);
CREATE INDEX IF NOT EXISTS idx_bars_date ON daily_bars(date);

-- Point-in-time fundamentals snapshot (latest reported per symbol/period).
CREATE TABLE IF NOT EXISTS fundamentals (
    symbol            TEXT NOT NULL,
    period            TEXT NOT NULL,    -- e.g. '2024-Q4' or fiscal date
    report_date       TEXT,
    revenue           REAL,
    revenue_yoy       REAL,             -- % YoY growth
    net_income        REAL,
    gross_margin      REAL,
    debt_to_equity    REAL,
    current_ratio     REAL,
    fcf               REAL,
    roe               REAL,
    pe                REAL,
    ev_ebitda         REAL,
    PRIMARY KEY (symbol, period)
);

-- Earnings calendar.
CREATE TABLE IF NOT EXISTS earnings_calendar (
    symbol       TEXT NOT NULL,
    date         TEXT NOT NULL,
    eps_est      REAL,
    eps_actual   REAL,
    rev_est      REAL,
    rev_actual   REAL,
    "time"       TEXT,               -- bmo / amc
    PRIMARY KEY (symbol, date)
);

-- Earnings-call transcripts (concalls) for risk/guidance tracking.
CREATE TABLE IF NOT EXISTS transcripts (
    symbol     TEXT NOT NULL,
    period     TEXT NOT NULL,
    date       TEXT,
    content    TEXT,
    PRIMARY KEY (symbol, period)
);

-- Daily breadth snapshot (computed, one row per date).
CREATE TABLE IF NOT EXISTS breadth (
    date               TEXT PRIMARY KEY,
    universe_size      INTEGER,
    pct_above_200ema   REAL,
    pct_above_50ema    REAL,
    new_52w_highs      INTEGER,
    new_52w_lows       INTEGER,
    advancers          INTEGER,
    decliners          INTEGER,
    regime             TEXT            -- aggressive | moderate | shallow
);

-- Stored concall digests (heuristic or LLM) for tracking guidance over time.
CREATE TABLE IF NOT EXISTS concall_summaries (
    symbol     TEXT NOT NULL,
    period     TEXT NOT NULL,
    method     TEXT,               -- heuristic | claude
    tone       TEXT,               -- positive | cautious | neutral
    digest     TEXT,               -- rendered markdown digest
    created_at TEXT,
    PRIMARY KEY (symbol, period, method)
);

-- Ingestion bookkeeping so we know what has been fetched.
CREATE TABLE IF NOT EXISTS ingest_log (
    source     TEXT NOT NULL,
    key        TEXT NOT NULL,     -- e.g. a date or symbol
    fetched_at TEXT,
    rows       INTEGER,
    PRIMARY KEY (source, key)
);
