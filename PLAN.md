# BNBClaw — Implementation Plan

## 🦞 Project Overview

**BNBClaw** is an OpenClaw AI agent that maximizes BNB utility on Binance without ever selling BNB. It auto-subscribes to Launchpool/Simple Earn, accumulates BNB through trading, and hedges downside risk — all controlled via chat.

---

## Core Strategy

```
┌─────────────────────┐
│     BNB WALLET      │
│   (Simple Earn)     │
│  Launchpool +       │
│  HODLer Airdrop     │
└─────────┬───────────┘
          │
 Airdrops/Launchpool tokens
          │
          ▼
  ┌───────────────┐
  │  SELL TO USDT │──────────┐
  └───────────────┘          │
                             ▼
                    ┌──────────────────┐
                    │   USDT WALLET    │
                    │  (Trading Fund)  │
                    └────────┬─────────┘
                             │
                      Trades BNB/USDT
                       (Long & Short)
                             │
                ┌────────────┴────────────┐
                ▼                         ▼
       SHORT Profit                LONG Profit
       (BNB dropped)              (BNB pumped)
                │                         │
                ▼                         ▼
        BUY MORE BNB              STAYS AS USDT
        → BNB Wallet              (margin + dry powder)
```

### Rules
1. **BNB never gets sold** — only accumulated
2. **USDT is the working capital** — takes hits, gets replenished by free yield
3. **Short profits → buy BNB** (accumulate at discount)
4. **Long profits → keep USDT** (grow war chest)
5. **Airdrop/Launchpool rewards → sell to USDT** (refill trading fund)
6. **USDT floor** — agent stops trading if USDT drops to user-defined minimum

---

## Architecture

```
                    ┌──────────────┐
                    │  TradingView │ (optional)
                    │  Webhooks    │
                    └──────┬───────┘
                           │ HTTP POST
                           ▼
┌─────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Telegram   │◄───►│  OpenClaw Gateway │◄───►│  LLM Brain  │
│             │     │    (Node.js)      │     │  (Claude)   │
└─────────────┘     └────────┬─────────┘     └─────────────┘
                             │
                    ┌────────┴────────┐
                    │  BNBClaw Plugin  │
                    │  (TypeScript)    │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐     ┌────────────┐
│ Binance API  │    │  Webhook     │     │  State DB  │
│   (REST)     │    │  (optional)  │     │  (SQLite)  │
└──────────────┘    └──────────────┘     └────────────┘
```

### Dual-Mode Operation

BNBClaw works in two modes:

1. **OpenClaw Plugin** (recommended) — Loaded by the OpenClaw gateway via `openclaw.config.json`.
   OpenClaw handles multi-channel messaging (Telegram, WhatsApp, Discord, etc.) and LLM routing.
   BNBClaw registers 17 LLM-callable tools, 1 background service, 1 HTTP route,
   and lifecycle hooks. Plugin config is validated against `openclaw.plugin.json` manifest.

2. **Standalone** — Run via `npm start`. Uses built-in Telegram polling + LLM router
   (set `LLM_API_KEY` in `.env`). No OpenClaw dependency required.

---

## Project Structure

```
BNBClaw/
├── PLAN.md                     # This file
├── README.md                   # Project docs, setup guide, screenshots
├── package.json                # Node.js dependencies + openclaw.plugin field
├── tsconfig.json               # TypeScript config
├── .env.example                # API keys template (standalone mode)
├── openclaw.config.json        # OpenClaw gateway config (plugin mode)
├── openclaw.plugin.json        # Plugin manifest — configSchema, metadata
├── Dockerfile                  # Container build for deployment
├── deploy.sh                   # VM deploy script (standalone or plugin)
│
├── src/
│   ├── index.ts                # Entry point — standalone mode (npm start)
│   │
│   ├── config/
│   │   └── settings.ts         # User settings: USDT floor, leverage, risk params
│   │
│   ├── api/
│   │   ├── plugin.ts           # OpenClaw plugin entry — tools/service/hooks/route
│   │   ├── openclaw-types.ts   # Full type definitions for OpenClaw plugin SDK
│   │   ├── binance-client.ts   # Binance REST API wrapper (authenticated)
│   │   ├── webhook-server.ts   # HTTP server for TradingView webhook alerts
│   │   ├── telegram.ts         # Telegram Bot API (standalone mode)
│   │   ├── llm-router.ts       # LLM function-calling router (standalone mode)
│   │   └── types.ts            # API response types
│   │
│   ├── core/
│   │   ├── earn-manager.ts     # Simple Earn subscribe/redeem, Launchpool monitor
│   │   ├── event-scheduler.ts   # Schedules future actions (Launchpool start/end, Megadrop)
│   │   ├── trade-engine.ts     # BNB/USDT spot & futures trading logic
│   │   ├── strategy.ts         # Built-in strategy (funding rate + RSI fallback)
│   │   ├── hedge-manager.ts    # Delta-neutral hedge: open/close/rebalance shorts
│   │   ├── accumulator.ts      # Converts rewards → USDT or BNB per rules
│   │   └── risk-manager.ts     # USDT floor, position sizing, drawdown protection
│   │
│   ├── skills/
│   │   ├── status.ts           # "How's my BNB?" — portfolio overview skill
│   │   ├── earn.ts             # "Subscribe to Launchpool" — earn management skill
│   │   ├── trade.ts            # "Go long/short BNB" — manual trade skill
│   │   ├── hedge.ts            # "Activate hedge" — hedge control skill
│   │   ├── settings.ts         # "Set USDT floor to 500" — config skill
│   │   ├── rewards.ts          # "Convert my airdrops" — reward management skill
│   │   └── apy.ts              # APR rates for flexible + locked products
│   │
│   ├── heartbeat/
│   │   ├── scheduler.ts        # Heartbeat — runs every N minutes
│   │   ├── scheduled-jobs.ts   # Executes time-triggered jobs (Launchpool subscribe at T+0)
│   │   ├── reward-check.ts     # Fallback: polls getAssetDividend for missed rewards
│   │   ├── hedge-rebalance.ts  # Rebalances hedge if BNB balance changed
│   │   ├── funding-monitor.ts  # Monitors funding rate, alerts if negative
│   │   └── risk-check.ts       # Checks USDT floor, margin health, liquidation
│   │
│   ├── db/
│   │   ├── database.ts         # SQLite connection
│   │   ├── schema.sql          # Tables: trades, rewards, balances, settings
│   │   └── queries.ts          # DB query helpers
│   │
│   └── utils/
│       ├── logger.ts           # Structured logging
│       ├── formatter.ts        # Format numbers, BNB amounts, PnL for chat display
│       └── crypto.ts           # Encrypt/decrypt API keys at rest
│
├── tests/
│   ├── trade-engine.test.ts
│   ├── hedge-manager.test.ts
│   ├── risk-manager.test.ts
│   └── accumulator.test.ts
│

```

---

## Module Details

### 1. `api/binance-client.ts` — Binance API Wrapper

Wraps authenticated Binance REST API calls.

**Methods:**
- `getSpotBalance(asset)` — Get BNB/USDT spot balance
- `getFuturesBalance()` — Get futures wallet USDT balance
- `getFuturesPositions()` — Get open positions
- `getEarnPositions()` — Get Simple Earn subscriptions
- `subscribeEarn(asset, amount)` — Subscribe to Simple Earn flexible
- `redeemEarn(asset, amount)` — Redeem from Simple Earn
- `placeFuturesOrder(side, quantity, leverage)` — Open/close futures position
- `placeSpotOrder(side, quantity)` — Buy/sell on spot
- `getFundingRate(symbol)` — Current and predicted funding rate
- `getAssetDividend(limit?)` — Poll `GET /sapi/v1/asset/assetDividend` for all automatic distributions (HODLer Airdrops, Launchpool rewards, Earn interest, promos)
- `getConvertQuote(from, to, amount)` — `POST /sapi/v1/convert/getQuote` for tokens without a direct USDT pair
- `convertSmallBalance()` — `POST /sapi/v1/asset/dust` to sweep unsellable dust into BNB

**Security:**
- API keys encrypted at rest via `utils/crypto.ts`
- Keys never logged, never sent to LLM
- Read-only vs trade permissions clearly separated
- IP whitelist recommended in Binance API settings

### 2. `core/earn-manager.ts` — Earn & Reward Manager

**Key Insight:** BNB in Simple Earn Flexible **automatically** qualifies for:
- Launchpool farming (no manual subscribe needed)
- HODLer Airdrops
- Flexible Earn APY

All three run simultaneously. No redeem/re-subscribe cycle required.

**Responsibilities:**
- Ensure all BNB stays parked in Simple Earn Flexible at all times
- Sweep idle spot BNB into Simple Earn Flexible
- Poll `getAssetDividend` for reward detection via heartbeat
- Verify rewards before selling (never sell user's manual buys)
- Auto-sell confirmed reward tokens to USDT
- Track reward history in DB

**Heartbeat Poll (every 30 min)**
```
on_heartbeat():
    // Keep BNB parked
    idle_bnb = api.getSpotBalance("BNB")
    if idle_bnb > 0.01:
        subscribe to Simple Earn Flexible
        notify: "Moved {X} idle BNB to Simple Earn."

    // Check for new reward distributions
    distributions = api.getAssetDividend(limit=20)
    for dist in distributions:
        if already_in_db(dist.tranId): skip
        log to rewards table
        if dist.asset == "BNB": continue
        sell_to_usdt(dist.asset, dist.amount)
        notify: "Sold {amount} {asset} → {usdt} USDT"

    // Periodic dust cleanup (weekly)
    if is_weekly_cleanup_time():
        api.convertSmallBalance()     // POST /sapi/v1/asset/dust → BNB
```

**sell_to_usdt(asset, amount):**
```
    if spot_pair_exists(asset, "USDT"):
        sell via placeSpotOrder
    else:
        // Fallback: Binance Convert API (supports nearly all tokens)
        quote = api.getConvertQuote(asset, "USDT", amount)
        accept quote
```

### 3. `core/event-scheduler.ts` — Scheduled Event Manager

**Purpose:** Handle timed Binance events that require manual action (e.g., Megadrop
Web3 quests). Launchpool does NOT need scheduling — Simple Earn auto-covers it.

**Responsibilities:**
- Parse event announcements the user sends via chat
- Schedule future actions with exact timestamps
- Execute actions at the right time
- Sell reward tokens when events end

**Example — Megadrop:**
```
User: "Megadrop TOKEN_Y starts March 15, complete Web3 quest at megadrop.binance.com"

Agent parses → creates scheduled jobs:

  Job 1: T+0 (March 15)
    → Notify: "🦞 TOKEN_Y Megadrop started! Complete the Web3 quest."
    → (Agent can't do Web3 quests — reminds user)

  Job 2: Distribution day
    → Detect TOKEN_Y reward
    → Sell TOKEN_Y to USDT
    → Notify: "Sold {Y} TOKEN_Y → {Z} USDT"
```

**Note:** For Launchpool, the agent simply monitors reward distributions and
auto-sells them. No scheduling needed since BNB in Simple Earn Flexible
automatically participates.

**Storage:** Scheduled jobs persist in SQLite so they survive agent restarts.

### 3. `core/trade-engine.ts` — Trading Engine

**Responsibilities:**
- Execute BNB/USDT trades (spot + futures)
- Apply position sizing from risk manager
- Route profits per rules: short profit → buy BNB, long profit → keep USDT

**Trade Execution Flow:**
```
execute_trade(signal):
    mode = risk_manager.get_mode()  // ACTIVE, CONSERVATIVE, PASSIVE
    
    if mode == "PASSIVE":
        return "Trading paused — USDT below floor"
    
    size = risk_manager.calculate_size(signal, mode)
    
    if signal.direction == "SHORT":
        open futures short
    
    if signal.direction == "LONG":
        open futures long
```

**Profit Routing (on trade close):**
```
on_trade_close(trade):
    if trade.pnl <= 0: return       // loss — nothing to route

    if trade.direction == "SHORT":
        // Accumulate toward BNB purchase threshold
        db.short_profit_buffer += trade.pnl
        
        if short_profit_buffer >= settings.bnb_buy_threshold:  // default $50
            buy BNB on spot with short_profit_buffer USDT
            move BNB to Simple Earn
            reset short_profit_buffer to 0
            notify: "Accumulated ${buffer} in short profits → bought {Y} BNB"
        else:
            notify: "Short profit +${pnl}. Buffer: ${buffer}/${threshold} toward next BNB buy."
    
    if trade.direction == "LONG":
        // Keep USDT in futures wallet (grows war chest)
        notify: "Long profit +${pnl}. USDT balance: ${total}"
```

**Signal Sources (priority order):**
```
1. RISK CHECK            → always first (USDT floor, margin health)
2. TRADINGVIEW WEBHOOK   → if configured, external signals take priority
3. BUILT-IN STRATEGY     → fallback when no webhook (funding rate + RSI)
4. CHAT COMMAND          → user says "go short" manually (always available)
```

The trade engine is **strategy-agnostic** — it receives signals from any source
and applies the same risk rules + profit routing to all of them.

### 4. `api/webhook-server.ts` — TradingView Webhook Listener

**Responsibilities:**
- HTTP server listening for incoming TradingView webhook alerts
- Validates webhook secret token (prevents spoofing)
- Parses signal and forwards to trade engine
- Optional — if user doesn't configure TradingView, this is simply inactive

**Webhook Payload Format:**
```json
{
    "secret": "user-defined-token",
    "action": "LONG",
    "ticker": "BNBUSDT",
    "price": "620.50",
    "comment": "RSI oversold bounce"
}
```

**Supported Actions:** `LONG`, `SHORT`, `CLOSE_LONG`, `CLOSE_SHORT`, `CLOSE_ALL`

**Security:**
- Secret token validated on every request
- Rejects any request without valid secret
- Rate-limited (max 1 signal per 10 seconds to prevent spam)
- Binds to localhost by default (use Cloudflare Tunnel / ngrok for external access)

### 5. `core/strategy.ts` — Built-In Trading Strategy

**Purpose:** Provides trading signals when TradingView webhooks are NOT configured.
This is the fallback so BNBClaw works standalone without any external dependency.

**Strategy Layers:**
```
LAYER 1 — Funding Rate (passive, always on):
    IF funding rate > +0.05%  → SHORT bias (you get paid every 8h)
    IF funding rate < -0.05%  → LONG bias (you get paid every 8h)
    IF neutral                → no signal

LAYER 2 — RSI Mean Reversion (swing trades):
    IF RSI(14) on 4h < 30    → LONG signal (oversold bounce)
    IF RSI(14) on 4h > 70    → SHORT signal (overbought pullback)
    Take profit at RSI ~ 50
```

**Why this works for BNBClaw:**
- Funding rate = near-zero risk passive income
- RSI extremes = high-conviction, low-frequency trades (~3-8/month)
- Both use Binance REST API data (funding rate endpoint + price data)

**When TradingView IS configured:**
- Built-in strategy goes silent (or can run in "alert-only" mode)
- TradingView signals take priority
- User can swap Pine Script strategies without touching code

**Example Pine Script (for users who want TradingView):**
```pinescript
//@version=5
strategy("BNBClaw RSI", overlay=true)
rsi = ta.rsi(close, 14)

if ta.crossunder(rsi, 30)
    strategy.entry("Long", strategy.long)
    alert('{"secret":"YOUR_SECRET","action":"LONG","ticker":"BNBUSDT","price":' + str.tostring(close) + '}', alert.freq_once_per_bar)

if ta.crossover(rsi, 70)
    strategy.entry("Short", strategy.short)
    alert('{"secret":"YOUR_SECRET","action":"SHORT","ticker":"BNBUSDT","price":' + str.tostring(close) + '}', alert.freq_once_per_bar)
```

### 6. `core/hedge-manager.ts` — Delta-Neutral Hedge

**Responsibilities:**
- Open/close hedge positions (short BNB perp)
- Rebalance when BNB balance changes (earned more from Launchpool)
- Monitor funding rate cost/income

**Logic:**
```
activate_hedge():
    bnb_in_earn = api.getEarnPositions("BNB").total
    usdt_available = api.getFuturesBalance() - settings.usdt_floor
    
    max_hedge_size = usdt_available * leverage / bnb_price
    hedge_ratio = min(max_hedge_size / bnb_in_earn, 1.0)
    
    open SHORT bnb_in_earn * hedge_ratio
    notify: "🛡️ Hedge active. {hedge_ratio*100}% of {bnb_in_earn} BNB hedged."

rebalance():  // called by heartbeat
    current_short = api.getFuturesPositions("BNBUSDT").size
    bnb_in_earn = api.getEarnPositions("BNB").total
    target_short = bnb_in_earn * hedge_ratio
    
    diff = target_short - current_short
    if abs(diff) > 0.1:  // threshold to avoid dust trades
        adjust position by diff
        notify: "Rebalanced hedge: {current_short} → {target_short} BNB"
```

### 7. `core/accumulator.ts` — Reward Conversion Engine

**Responsibilities:**
- Detect new airdrop/Launchpool reward distributions
- Auto-sell non-BNB tokens to USDT
- Route per rules: rewards → USDT (trading fund refill)
- Track all conversions in DB

**Logic:**
```
on_heartbeat():
    new_rewards = api.getRecentDistributions(since=last_check)
    
    for reward in new_rewards:
        if reward.asset == "BNB":
            send to Simple Earn  // never sell BNB
        else:
            sell reward.asset for USDT on spot
            log conversion
            notify: "💰 Sold {amount} {TOKEN} for {usdt_amount} USDT"
```

### 8. `core/risk-manager.ts` — Risk & Position Sizing

**Responsibilities:**
- Enforce USDT floor (never trade below it)
- Calculate position sizes based on available capital
- Monitor liquidation proximity on futures
- Track rolling 30-day actual income from rewards

**Modes:**
```
ACTIVE:       USDT > floor * 2.0    → full position sizing
CONSERVATIVE: USDT > floor * 1.3    → 50% position sizing  
PASSIVE:      USDT <= floor         → no trading, earn only

Position size = (USDT - floor) * risk_per_trade (default 5%)
```

**Liquidation Protection:**
```
on_heartbeat():
    margin_ratio = api.getFuturesMarginRatio()
    
    if margin_ratio > 80%:
        ALERT: "⚠️ DANGER: Margin ratio {margin_ratio}%. Reducing position."
        reduce position by 50%
    
    if margin_ratio > 60%:
        WARN: "⚡ Margin ratio {margin_ratio}%. Monitoring closely."
```

---

## Chat Commands (OpenClaw Tools + Standalone)

### `skills/status.ts` — Portfolio Overview
```
User: "How's my BNB?"

Agent: "🦞 BNBClaw Status
━━━━━━━━━━━━━━━━━━━━
BNB Holdings:
  Simple Earn:     10.5 BNB (auto: Launchpool + Airdrops + APY)
  Spot:            0.0 BNB
  Total:           10.5 BNB (+0.5 since last week)

USDT Trading Fund:
  Balance:         $1,847
  Floor:           $500
  Available:       $1,347
  Mode:            🟢 ACTIVE

Hedge:
  Status:          ON (85% hedged)
  Short Size:      8.925 BNB
  Funding Income:  +$12.40 (24h)

Today's P&L:
  Trading:         +$45 (1 short closed)
  Rewards:         +$32 (sold AIRDROP_TOKEN)
  Net:             +$77

BNB Accumulated This Month: +1.2 BNB"
```

### `skills/earn.ts` — Earn Management
```
User: "Move BNB to Simple Earn"
Agent: "✅ Moved {X} BNB to Simple Earn Flexible. Your BNB now earns
  APY + auto-qualifies for Launchpool + HODLer Airdrops."

User: "How much am I earning?"
Agent: "🦞 Earn Status:
  Simple Earn:     8.5 BNB (Flexible)
  APY:             ~1.2%
  Active Launchpool: TOKEN_X (auto-subscribed via Simple Earn)
  Rewards pending: 45 TOKEN_X (~$12)
  Last airdrop:    200 AIRDROP_Y → sold for $32 USDT"

--- Scheduled Megadrop ---
User: "Megadrop TOKEN_Y starts March 15"
Agent: "🦞 Got it! Scheduled:
  • Reminder on Mar 15: complete Web3 quest
  • Auto-sell TOKEN_Y rewards when distributed
  Check with 'show scheduled jobs'."

User: "Show scheduled jobs"
Agent: "📅 Scheduled Jobs:
  1. TOKEN_Y Megadrop
     Reminder:        Mar 15 10:00 UTC  ⏳ pending
     Sell rewards:    TBD (on distribution)  ⏳ pending"
```

### `skills/trade.ts` — Manual Trading
```
User: "Go short BNB"
User: "Close my position"
User: "What's the funding rate?"
```

### `skills/hedge.ts` — Hedge Control
```
User: "Activate hedge"
User: "Deactivate hedge"
User: "What's my hedge status?"
```

### `skills/settings.ts` — Configuration
```
User: "Set USDT floor to 500"
User: "Set leverage to 5x"
User: "Set risk per trade to 3%"
User: "Set BNB buy threshold to 100"
User: "Show my settings"
```

### `skills/rewards.ts` — Reward Management
```
User: "Convert my airdrops"
User: "What rewards did I get this month?"
User: "How much USDT came from rewards?"
```

---

## Heartbeat Schedule

| Check | Frequency | Module |
|---|---|---|
| Scheduled Jobs | Every 30 sec | `scheduled-jobs.ts` |
| New Rewards (fallback) | Every 30 min | `reward-check.ts` |
| Hedge Rebalance | Every 1 hour | `hedge-rebalance.ts` |
| Funding Rate | Every 4 hours | `funding-monitor.ts` |
| Risk/Margin Check | Every 5 min | `risk-check.ts` |
| USDT Floor Check | Every 5 min | `risk-check.ts` |

---

## Database Schema

```sql
-- Track all trades
CREATE TABLE trades (
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
CREATE TABLE rewards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    source TEXT NOT NULL,           -- 'LAUNCHPOOL' | 'AIRDROP' | 'EARN_INTEREST'
    asset TEXT NOT NULL,
    amount REAL NOT NULL,
    converted_to TEXT,             -- 'USDT' | 'BNB' | null
    converted_amount REAL
);

-- Track BNB balance over time
CREATE TABLE bnb_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    earn_balance REAL NOT NULL,
    spot_balance REAL NOT NULL,
    total REAL NOT NULL
);

-- Track USDT balance over time
CREATE TABLE usdt_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    futures_balance REAL NOT NULL,
    spot_balance REAL NOT NULL,
    total REAL NOT NULL
);

-- User settings
CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Short profit accumulation buffer
CREATE TABLE accumulator (
    id INTEGER PRIMARY KEY CHECK (id = 1),  -- single row
    short_profit_buffer REAL NOT NULL DEFAULT 0
);

-- Scheduled jobs (Launchpool start/end, Megadrop, etc.)
CREATE TABLE scheduled_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name TEXT NOT NULL,       -- 'TOKEN_X Launchpool'
    action TEXT NOT NULL,           -- 'REDEEM_EARN' | 'SUBSCRIBE_POOL' | 'END_POOL_SELL'
    execute_at TEXT NOT NULL,       -- ISO timestamp (UTC)
    payload TEXT,                   -- JSON: { poolId, token, amount, ... }
    status TEXT NOT NULL,           -- 'PENDING' | 'EXECUTING' | 'DONE' | 'FAILED'
    created_at TEXT NOT NULL,
    executed_at TEXT
);
```

---

## Implementation Order

### Phase 1 — Foundation (Core API + Earn)
1. Project setup (package.json, tsconfig, .env)
2. `api/binance-client.ts` — REST API wrapper
3. `db/` — SQLite setup + schema
5. `config/settings.ts` — User settings
6. `core/earn-manager.ts` — Simple Earn + Reward auto-sell
7. `core/event-scheduler.ts` — Scheduled Megadrop/event actions
8. `skills/earn.ts` + `skills/status.ts`
9. `heartbeat/reward-check.ts` (fallback poll) + `heartbeat/scheduled-jobs.ts`

### Phase 2 — Trading + Accumulation
9. `core/risk-manager.ts` — USDT floor, position sizing
10. `core/strategy.ts` — Built-in funding rate + RSI strategy
11. `core/trade-engine.ts` — Long/short execution
12. `api/webhook-server.ts` — TradingView webhook listener
13. `core/accumulator.ts` — Reward → USDT conversion
14. `skills/trade.ts` + `skills/rewards.ts`

### Phase 3 — Hedge
16. `core/hedge-manager.ts` — Delta-neutral hedge
17. `skills/hedge.ts`
18. `heartbeat/hedge-rebalance.ts`
19. `heartbeat/funding-monitor.ts`

### Phase 4 — Risk + Polish
20. `heartbeat/risk-check.ts` — Margin/liquidation monitoring
21. `skills/settings.ts`
22. `utils/` — Logger, formatter, encryption
23. Tests
24. README + docs

---

## Security Checklist

- [ ] API keys encrypted at rest (AES-256)
- [ ] API keys never sent to LLM / never in chat logs
- [ ] Binance API key scoped: enable spot+futures trade, disable withdraw
- [ ] IP whitelist on Binance API key
- [ ] USDT floor enforced — cannot be bypassed
- [ ] Max position size cap (even in ACTIVE mode)
- [ ] Liquidation auto-protection (reduce at 60% margin ratio)
- [ ] All trades logged to DB with full audit trail
- [ ] Human-in-the-Loop option for large trades (> X BNB)
- [ ] No hardcoded secrets in source code
- [ ] OpenClaw plugin permissions: no shell access, no file system access beyond DB
- [ ] Webhook server: secret token validation on every request
- [ ] Webhook server: rate-limited (1 signal per 10s)
- [ ] Webhook server: binds to localhost by default

---

## Tech Stack

| Component | Technology |
|---|---|
| Runtime | Node.js 22+ / TypeScript |
| AI Agent | OpenClaw Plugin (via plugin-sdk) or Standalone |
| LLM | Anthropic Claude (via OpenClaw gateway) |
| Exchange API | Binance REST (polling-based) |
| Strategy Signals | Built-in (funding rate + RSI) or TradingView Webhooks |
| Database | SQLite (better-sqlite3) |
| Messaging | Telegram (OpenClaw gateway or standalone polling) |
| Testing | Vitest |

---

## Success Metrics

| Metric | Target |
|---|---|
| BNB accumulated / month | Positive (never negative) |
| Launchpool participation | 100% (auto via Simple Earn) |
| USDT trading fund health | Never below floor |
| Hedge accuracy | Within 5% of target ratio |
| Uptime | Heartbeat runs continuously |
