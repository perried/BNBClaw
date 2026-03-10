# 🦞 BNBClaw

**AI agent that maximizes BNB utility on Binance — auto-earn, trading, hedging, and reward accumulation.**

Built for the [Binance OpenClaw AI Hackathon](https://www.binance.com/en/openclaw) using the OpenClaw framework.

---

## What It Does

BNBClaw is an OpenClaw AI agent plugin that grows your BNB stack without ever selling BNB. It follows one rule: **BNB only goes up, never out.**

It works in two modes:
- **OpenClaw Plugin** — loaded by the OpenClaw gateway for multi-channel support (Telegram, WhatsApp, Discord, etc.) with full LLM reasoning
- **Standalone** — run via `npm start` with built-in Telegram bot and optional LLM router

| Feature | Description |
|---------|-------------|
| **Auto-Earn** | BNB automatically stays in Simple Earn Flexible, qualifying for Launchpool, HODLer Airdrops, and APY simultaneously |
| **Trading** | Opens leveraged futures positions (long/short) on BNBUSDT via TradingView webhooks or built-in funding-rate strategy |
| **Accumulation** | Short trade profits accumulate in a buffer, then batch-buy BNB → Simple Earn |
| **Reward Conversion** | Launchpool/airdrop tokens detected via WebSocket, verified, sold to USDT |
| **Delta-Neutral Hedge** | Optional futures short to protect BNB value during drawdowns |
| **Risk Management** | USDT floor enforcement, position sizing, margin health monitoring, 3-tier trading modes |
| **Telegram** | Natural language chat interface via LLM-powered Telegram bot |

## Capital Flow

```
Short Profit ──→ Buffer ($50 threshold) ──→ Buy BNB ──→ Simple Earn
Long Profit  ──→ Keep USDT (trading capital)
Rewards      ──→ Sell to USDT (verified via getAssetDividend)
BNB          ──→ NEVER SOLD
```

## Architecture

```
src/
├── api/
│   ├── plugin.ts            # OpenClaw plugin entry (tools + commands + service)
│   ├── openclaw-types.ts    # Local OpenClaw SDK type definitions
│   ├── binance-client.ts    # REST API wrapper (HMAC-SHA256 signed)
│   ├── binance-ws.ts        # WebSocket streams (market + user data)
│   ├── webhook-server.ts    # TradingView webhooks
│   ├── telegram.ts          # Telegram Bot API (standalone mode)
│   ├── llm-router.ts        # LLM function-calling router (standalone mode)
│   └── types.ts             # All TypeScript interfaces
├── core/
│   ├── earn-manager.ts      # Simple Earn management + reward detection
│   ├── trade-engine.ts      # Futures order execution + profit routing
│   ├── risk-manager.ts      # USDT floor, position sizing, margin health
│   ├── hedge-manager.ts     # Delta-neutral hedge via futures short
│   ├── strategy.ts          # Built-in funding rate strategy
│   ├── accumulator.ts       # Manual reward conversion utility
│   └── event-scheduler.ts   # Megadrop & scheduled event reminders
├── skills/                  # Chat commands (status, trade, earn, hedge, settings, rewards)
├── heartbeat/               # Periodic task scheduler
├── db/                      # SQLite (better-sqlite3) — WAL mode, 7 tables
├── config/                  # Settings with DB persistence
├── utils/                   # Logger, formatter, AES-256-GCM encryption
└── index.ts                 # Standalone entry point
```

## Quick Start

### 1. Prerequisites

- Node.js 18+
- Binance account with Futures enabled
- API key with **Spot + Futures trading** permissions (withdraw DISABLED)

### 2. Install

```bash
git clone https://github.com/your-username/BNBClaw.git
cd BNBClaw
npm install
```

### 3. Configure

```bash
cp .env.example .env
```

Edit `.env` with your Binance API credentials:

```env
BINANCE_API_KEY=your_api_key
BINANCE_API_SECRET=your_api_secret
WEBHOOK_SECRET=a_random_string      # optional, for TradingView
```

### 4. Build & Run

**Standalone mode** (built-in Telegram + optional LLM):
```bash
npm run build
npm start
```

**OpenClaw plugin mode** (full multi-channel + LLM reasoning):
```bash
npm run build
npm install -g openclaw@latest
openclaw onboard --install-daemon
openclaw gateway --verbose
```

The agent starts and:
- Connects to Binance WebSocket streams
- Subscribes idle BNB to Simple Earn
- Starts the heartbeat scheduler
- Starts Telegram messaging (if LLM_API_KEY is set)

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

## Chat Commands

Available via Telegram (standalone), or any OpenClaw channel (plugin mode):

| Command | Action |
|---------|--------|
| `status` | Portfolio overview — BNB, USDT, mode, hedge |
| `earn status` | Simple Earn positions and APY |
| `subscribe BNB` | Move BNB to Simple Earn |
| `trade long 0.5` | Open long 0.5 BNB |
| `trade short` | Open short (auto-sized) |
| `close trade 3` | Close trade #3 |
| `close all` | Close all open trades |
| `hedge on` | Activate delta-neutral hedge |
| `hedge off` | Deactivate hedge |
| `set floor 300` | Set USDT floor to $300 |
| `set leverage 5` | Set leverage to 5x |
| `convert my airdrops` | Sell unconverted reward tokens to USDT |
| `rewards` | Recent reward history |

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

- **API keys encrypted at rest** with AES-256-GCM
- **Webhook server binds to 127.0.0.1 only** — not exposed to internet
- **No withdrawal permissions** — API key cannot move funds out
- **Signed requests** — all Binance API calls use HMAC-SHA256
- **Reward verification** — checks `getAssetDividend` before selling (never sells user's manual buys)
- **Rate limiting** — webhook accepts max 1 signal per 10 seconds

## Testing

```bash
npm test
```

25 tests covering formatter, encryption, database, and event scheduler.

## Tech Stack

- **Runtime**: Node.js 22+ / TypeScript
- **Framework**: OpenClaw (plugin-sdk) + standalone fallback
- **Exchange**: Binance REST + WebSocket API
- **Messaging**: Telegram (standalone) or OpenClaw multi-channel
- **LLM**: Any OpenAI-compatible API (function calling)
- **Database**: SQLite (better-sqlite3, WAL mode)
- **Encryption**: AES-256-GCM (Node.js crypto)
- **Testing**: Vitest

## License

MIT
