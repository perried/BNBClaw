# 🦞 BNBClaw

**AI agent that maximizes BNB utility on Binance — auto-earn, trading, hedging, and reward accumulation.**

Built for the [Binance OpenClaw AI Hackathon](https://www.binance.com/en/openclaw) (March 4–18, 2026) using the OpenClaw framework.

---

## What It Does

BNBClaw is an OpenClaw AI agent plugin that grows your BNB stack without ever selling BNB. It follows one rule: **BNB only goes up, never out.**

It works in two modes:
- **OpenClaw Plugin** — loaded by the OpenClaw gateway, accessible via Telegram with full LLM reasoning (Anthropic Claude)
- **Standalone** — run via `npm start` with built-in Telegram bot and optional LLM router

| Feature | Description |
|---------|-------------|
| **Auto-Earn** | BNB automatically stays in Simple Earn Flexible, qualifying for Launchpool, HODLer Airdrops, and APY simultaneously |
| **Trading** | Opens leveraged futures positions (long/short) on BNBUSDT via TradingView webhooks or built-in funding-rate strategy |
| **Accumulation** | Short trade profits accumulate in a buffer, then batch-buy BNB → Simple Earn |
| **Reward Detection** | Launchpool/airdrop tokens detected via `getAssetDividend` API, notified to user |
| **Wallet Management** | Scan wallets, convert dust/airdrops, transfer between spot/funding/futures/earn |
| **Delta-Neutral Hedge** | Optional futures short to protect BNB value during drawdowns |
| **Risk Management** | USDT floor enforcement, position sizing, margin health monitoring, 3-tier trading modes |
| **Live Market Data** | Real-time price lookups, APY rate comparison for flexible/locked products |
| **Telegram** | Natural language chat interface via LLM-powered Telegram bot |

## Capital Flow

```
Short Profit ──→ Buffer ($50 threshold) ──→ Buy BNB ──→ Simple Earn
Long Profit  ──→ Keep USDT (trading capital)
Rewards      ──→ Notify user (never auto-sold)
BNB          ──→ NEVER SOLD
```

## Architecture

```
src/
├── api/
│   ├── plugin.ts            # OpenClaw plugin entry (17 tools + service + hooks)
│   ├── openclaw-types.ts    # Local OpenClaw SDK type definitions
│   ├── binance-client.ts    # REST API wrapper (HMAC-SHA256 signed)
│   ├── webhook-server.ts    # TradingView webhooks
│   ├── telegram.ts          # Telegram Bot API (standalone mode)
│   ├── llm-router.ts        # LLM function-calling router (standalone mode)
│   └── types.ts             # All TypeScript interfaces
├── core/
│   ├── earn-manager.ts      # Simple Earn management + reward detection + dust cleanup
│   ├── trade-engine.ts      # Futures order execution + profit routing
│   ├── risk-manager.ts      # USDT floor, position sizing, margin health
│   ├── hedge-manager.ts     # Delta-neutral hedge via futures short
│   ├── strategy.ts          # Built-in funding rate strategy
│   ├── accumulator.ts       # Manual reward conversion utility
│   └── event-scheduler.ts   # Megadrop & scheduled event reminders
├── skills/
│   ├── status.ts            # Portfolio overview
│   ├── earn.ts              # Simple Earn positions + sweep BNB
│   ├── rewards.ts           # Live reward history (getAssetDividend)
│   ├── trade.ts             # Trade history + PnL
│   ├── hedge.ts             # Hedge status
│   ├── settings.ts          # Show/update settings
│   └── apy.ts               # Flexible + locked APY rates
├── heartbeat/               # Periodic task scheduler
├── db/                      # SQLite (better-sqlite3) — WAL mode, 7 tables
├── config/                  # Settings with DB persistence
├── utils/                   # Logger, formatter, AES-256-GCM encryption
└── index.ts                 # Standalone entry point
```

## LLM Tools

BNBClaw exposes 17 tools to the LLM via the OpenClaw plugin system. The AI decides which tool to call based on natural language:

| Tool | Description |
|------|-------------|
| `bnbclaw_status` | Full portfolio overview — BNB holdings, USDT balance, mode, hedge, PnL |
| `bnbclaw_earn` | Simple Earn positions and APY |
| `bnbclaw_rewards` | Live reward history from Binance API (airdrops, Launchpool, distributions) |
| `bnbclaw_trades` | Recent trade history with open/closed positions and PnL |
| `bnbclaw_hedge` | Hedge control — activate (on), deactivate (off), or show status |
| `bnbclaw_settings` | Show current settings |
| `bnbclaw_update_setting` | Update a setting (usdt_floor, leverage, risk_per_trade, etc.) |
| `bnbclaw_apy` | Live APY rates for flexible and locked Simple Earn products |
| `bnbclaw_price` | Live token price from Binance (default: BNBUSDT) |
| `bnbclaw_sweep` | Move idle BNB from spot wallet into Simple Earn |
| `bnbclaw_scan` | Scan spot + funding wallets for idle tokens, dust, unconverted airdrops |
| `bnbclaw_convert` | Convert a token to USDT or BNB (spot order or Convert API fallback) |
| `bnbclaw_transfer` | Transfer tokens between spot, funding, futures, and earn wallets |
| `bnbclaw_buy_bnb` | Buy BNB on spot market with USDT, optionally sweep to Simple Earn |
| `bnbclaw_open_position` | Open a futures position (LONG or SHORT) on BNBUSDT |
| `bnbclaw_close_position` | Close a position by trade ID, or close all open positions |
| `bnbclaw_positions` | View open futures positions with unrealized PnL |

## Quick Start

### 1. Prerequisites

- Node.js 22+
- Binance account with Futures enabled
- API key with **Spot + Futures + Universal Transfer** permissions (withdraw DISABLED)

### 2. Install

```bash
git clone https://github.com/perried/BNBClaw.git
cd BNBClaw
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret
WEBHOOK_SECRET=a_random_string      # optional, for TradingView
LLM_API_KEY=your_anthropic_key      # for standalone Telegram mode
```

### 4. Build & Run

**OpenClaw plugin mode** (recommended — Telegram via gateway):
```bash
npm run build
npm install -g openclaw@latest
openclaw onboard --install-daemon
openclaw gateway start
```

**Standalone mode** (built-in Telegram + LLM router):
```bash
npm run build
npm start
```

The agent starts and:
- Subscribes idle BNB to Simple Earn
- Starts the heartbeat scheduler (earn sweep, reward check, dust cleanup)
- Starts Telegram messaging

### 5. TradingView Webhooks (Optional)

Point your TradingView alert to `http://YOUR_SERVER:3000/webhook` with JSON body:

```json
{
  "secret": "your_webhook_secret",
  "direction": "LONG",
  "message": "BNB breakout"
}
```

Supported directions: `LONG`, `SHORT`, `CLOSE`

## Trading Modes

| Mode | Condition | Behavior |
|------|-----------|----------|
| **ACTIVE** | USDT > floor × 2 | Full position sizes |
| **CONSERVATIVE** | USDT > floor × 1.3 | 50% position sizes |
| **PASSIVE** | USDT ≤ floor | No trading, earn only |

## Configuration

All settings can be changed via chat or `.env` defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| `usdt_floor` | $500 | Minimum USDT reserve |
| `leverage` | 3x | Futures leverage |
| `risk_per_trade` | 5% | % of available capital per trade |
| `bnb_buy_threshold` | $50 | Buffer before batch-buying BNB |
| `hedge_ratio` | 85% | % of BNB to hedge |

## Security

- **No withdrawal permissions** — API key cannot move funds off Binance
- **Signed requests** — all Binance API calls use HMAC-SHA256
- **API keys encrypted at rest** with AES-256-GCM
- **Webhook server binds to 127.0.0.1 only** — not exposed to internet
- **Reward verification** — checks `getAssetDividend` before any conversion
- **Never sells BNB** — hardcoded rule enforced in convert tool
- **Rate limiting** — webhook accepts max 1 signal per 10 seconds

## Testing

```bash
npm test
```

25 tests covering formatter, encryption, database, and event scheduler.

## Tech Stack

- **Runtime**: Node.js 22 / TypeScript (CommonJS)
- **Framework**: OpenClaw 2026.3.8 plugin SDK
- **LLM**: Anthropic Claude (sonnet-4-20250514) via OpenClaw gateway
- **Exchange**: Binance REST + WebSocket API
- **Messaging**: Telegram via OpenClaw gateway (or standalone polling)
- **Database**: SQLite (better-sqlite3, WAL mode)
- **Encryption**: AES-256-GCM (Node.js crypto)
- **Testing**: Vitest

## License

MIT
