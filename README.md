# 🦞 BNBClaw

**AI agent that maximizes BNB utility on Binance — auto-earn, trading, hedging, and reward accumulation.**


---

## What It Does

BNBClaw is an OpenClaw AI agent plugin that grows your BNB stack without ever selling BNB. It follows one rule: **BNB only goes up, never out.**

It works in two modes:
- **OpenClaw Plugin** — loaded by the OpenClaw gateway, accessible via Telegram with full LLM reasoning
- **Standalone** — run via `npm start` with built-in Telegram bot and LLM router

| Feature | Description |
|---------|-------------|
| **Chat-Based Setup** | Set up everything via Telegram — just send `/setup` to configure API keys, no file editing needed |
| **Auto-Earn** | BNB automatically stays in Simple Earn Flexible, qualifying for Launchpool, HODLer Airdrops, and APY simultaneously |
| **Trading** | Opens leveraged futures positions (long/short) on BNBUSDT via TradingView webhooks or built-in funding-rate strategy |
| **Accumulation** | Short trade profits accumulate in a buffer, then batch-buy BNB → Simple Earn |
| **Reward Detection** | Launchpool/airdrop tokens detected via `getAssetDividend` API, notified to user |
| **Wallet Management** | Scan wallets, convert dust/airdrops, transfer between spot/funding/futures/earn |
| **Delta-Neutral Hedge** | Optional futures short to protect BNB value during drawdowns (state persisted across restarts) |
| **Risk Management** | USDT floor enforcement, position sizing with validation bounds, margin health monitoring, 3-tier trading modes |
| **Live Market Data** | Real-time price lookups, APY rate comparison for flexible/locked products |
| **Telegram** | Natural language chat interface via LLM-powered Telegram bot with personality |

## Capital Flow

```
Short Profit ──→ Buffer ($50 threshold) ──→ Transfer USDT futures→spot ──→ Buy BNB ──→ Simple Earn
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
│   ├── telegram.ts          # Telegram Bot API with chat-based setup flow
│   ├── llm-router.ts        # LLM function-calling router (standalone mode)
│   └── types.ts             # All TypeScript interfaces
├── core/
│   ├── earn-manager.ts      # Simple Earn management + reward detection + dust cleanup
│   ├── trade-engine.ts      # Futures order execution + profit routing
│   ├── risk-manager.ts      # USDT floor, position sizing, margin health
│   ├── hedge-manager.ts     # Delta-neutral hedge via futures short (DB-persisted state)
│   ├── strategy.ts          # Built-in funding rate strategy
│   ├── accumulator.ts       # Manual reward conversion utility
│   └── event-scheduler.ts   # Megadrop & scheduled event reminders
├── skills/
│   ├── status.ts            # Portfolio overview
│   ├── earn.ts              # Simple Earn positions + sweep BNB
│   ├── rewards.ts           # Live reward history (getAssetDividend)
│   ├── trade.ts             # Trade history + PnL
│   ├── hedge.ts             # Hedge status
│   ├── settings.ts          # Show/update settings (with validation)
│   └── apy.ts               # Flexible + locked APY rates
├── heartbeat/               # Periodic task scheduler (with exponential backoff)
├── db/                      # SQLite (better-sqlite3) — WAL mode, 7 tables
├── config/                  # Settings with DB persistence + validation bounds
├── utils/
│   ├── logger.ts            # JSON structured logging
│   ├── formatter.ts         # Number formatting helpers
│   ├── crypto.ts            # AES-256-GCM encryption
│   ├── keystore.ts          # Encrypted API key storage (DB-backed)
│   └── reward-helpers.ts    # Shared reward classification + sell-to-USDT logic
└── index.ts                 # Standalone entry point (setup-first boot)
```

## Quick Start

### 1. Prerequisites

- Node.js 22+
- Binance account with Futures enabled
- API key with **Spot + Futures + Universal Transfer** permissions (withdraw DISABLED)
- A Telegram bot token (from [@BotFather](https://t.me/BotFather))

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

Add your Telegram bot token to `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
```

That's it! All other keys (Binance, LLM) can be set up via chat.

**Or**, if you prefer to configure everything in `.env`:

```env
TELEGRAM_BOT_TOKEN=your_bot_token
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret
LLM_API_KEY=your_openrouter_key
LLM_BASE_URL=https://openrouter.ai/api
LLM_MODEL=google/gemini-2.0-flash
```

### 4. Build & Run

**Standalone mode** (recommended for getting started):
```bash
npm run build
npm start
```

Then send `/start` to your bot on Telegram. If you haven't configured API keys in `.env`, the bot will walk you through setup right in the chat.

**OpenClaw plugin mode** (Telegram via gateway):
```bash
npm run build
npm install -g openclaw@latest
openclaw onboard --install-daemon
openclaw gateway start
```

### 5. Chat Setup Flow

If you start with just a Telegram token, the bot guides you through:

1. Send `/start` → Bot introduces itself, offers `/setup`
2. Send `/setup` → Bot asks for your **Binance API Key**
3. Paste your key → Bot asks for your **Binance API Secret**
4. Paste your secret → Bot asks for your **OpenRouter API Key** (or `/skip`)
5. All keys encrypted with AES-256-GCM and stored locally
6. Agent boots automatically — no restart needed

You can re-run `/setup` anytime to update your keys.

### 6. TradingView Webhooks (Optional)

Point your TradingView alert to `http://YOUR_SERVER:3000/webhook` with JSON body:

```json
{
  "secret": "your_webhook_secret",
  "direction": "LONG",
  "message": "BNB breakout"
}
```

Supported directions: `LONG`, `SHORT`, `CLOSE`

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
| `bnbclaw_update_setting` | Update a setting with validation (usdt_floor, leverage, risk_per_trade, etc.) |
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

## Trading Modes

| Mode | Condition | Behavior |
|------|-----------|----------|
| **ACTIVE** | USDT > floor x 2 | Full position sizes |
| **CONSERVATIVE** | USDT > floor | 50% position sizes |
| **PASSIVE** | USDT <= floor | No trading, earn only |

## Configuration

All settings can be changed via chat or `.env` defaults. Input validation enforces safe bounds:

| Setting | Default | Range | Description |
|---------|---------|-------|-------------|
| `usdt_floor` | $500 | 0–100,000 | Minimum USDT reserve |
| `leverage` | 3x | 1–20 | Futures leverage |
| `risk_per_trade` | 5% | 1–20% | % of available capital per trade |
| `bnb_buy_threshold` | $50 | 5–10,000 | Buffer before batch-buying BNB |
| `hedge_ratio` | 85% | 0–100% | % of BNB to hedge |

## Security

- **No withdrawal permissions** — API key cannot move funds off Binance
- **Signed requests** — all Binance API calls use HMAC-SHA256
- **API keys encrypted at rest** — AES-256-GCM via auto-generated encryption key
- **Chat-based key setup** — keys never need to exist in config files
- **Input validation** — all numeric parameters validated with min/max bounds
- **Webhook server binds to 127.0.0.1 only** — not exposed to internet
- **Reward verification** — checks `getAssetDividend` before any conversion
- **Never sells BNB** — hardcoded rule enforced in convert tool
- **Rate limiting** — webhook accepts max 1 signal per 10 seconds
- **Hedge state persisted** — survives process restarts via DB

## Testing

```bash
npm test
```

25 tests covering formatter, encryption, database, and event scheduler.

## Tech Stack

- **Runtime**: Node.js 22 / TypeScript (strict mode, CommonJS)
- **Framework**: OpenClaw 2026.3.8 plugin SDK
- **LLM**: Google Gemini 2.0 Flash via OpenRouter (configurable — any OpenAI-compatible API)
- **Exchange**: Binance REST API (HMAC-SHA256 signed)
- **Messaging**: Telegram Bot API (with chat-based onboarding)
- **Database**: SQLite (better-sqlite3, WAL mode)
- **Encryption**: AES-256-GCM (Node.js crypto)
- **Testing**: Vitest

## License

MIT
