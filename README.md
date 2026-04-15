# BNBClaw

BNBClaw is an installable OpenClaw assistant for Binance users who want to keep accumulating BNB without constantly trading in and out of their position.

## The BNB Dilemma

Holding BNB unlocks Launchpool rewards, HODLer Airdrops, trading fee discounts, and Simple Earn yield. The downside is volatility: when BNB drops, the USD value of your stack drops with it.

A lot of people solve that stress by selling BNB, but that often means missing the next Launchpool, losing Earn yield, and being underexposed when price recovers.

BNBClaw is built around a stricter rule: never sell spot BNB. Instead, it helps you keep idle BNB productive, clean up reward flows, move balances where they need to go, and carry your preferred hedge playbook in chat through custom hedge skills.

## What BNBClaw Does

| Goal | How BNBClaw helps |
|------|-------------------|
| Keep BNB productive | Shows Simple Earn balances and sweeps idle spot or funding BNB into Flexible Earn |
| Reduce reward clutter | Tracks Launchpool and HODLer rewards and retries eligible conversions to USDT |
| Clean up leftovers | Converts dust balances into BNB while excluding recent reward assets |
| Move capital cleanly | Transfers balances between spot, funding, and Earn |
| Accumulate more BNB | Buys BNB with available USDT when you tell it to |
| Stay strategy-aware | Installs or imports custom hedge skills that shape hedge-related guidance |

## Install

```bash
openclaw plugins install github:perried/BNBClaw
```

## Configure

Start the plugin:

```bash
openclaw plugins start bnbclaw
```

Then send your Binance credentials in chat so BNBClaw can store them locally:

```text
Use bnbclaw_set_credentials with my Binance API key and secret.
```

Use a Binance API key with spot read and trading enabled, and withdraw disabled. Legacy config fields still work, but chat-based setup is the preferred path.

You can remove saved credentials at any time with:

```text
Use bnbclaw_clear_credentials.
```

## Quick Start

Try prompts like:

- `Use bnbclaw_status to show my BNB portfolio overview.`
- `Use bnbclaw_earn to show my Simple Earn balances.`
- `Use bnbclaw_rewards for the last 30 days.`
- `Use bnbclaw_scan to show my spot and funding wallets.`
- `Use bnbclaw_buy_bnb with amount_usdt=100.`

## Tools

All tools are namespaced under `bnbclaw_*`.

| Tool | Purpose |
|------|---------|
| `bnbclaw_status` | Portfolio overview with BNB-focused balances |
| `bnbclaw_set_credentials` | Store Binance API credentials from chat |
| `bnbclaw_clear_credentials` | Remove saved Binance credentials |
| `bnbclaw_earn` | Show Simple Earn balances and conversion activity |
| `bnbclaw_rewards` | Show Launchpool, HODLer, and related reward history |
| `bnbclaw_convert_rewards` | Retry eligible reward conversions to USDT |
| `bnbclaw_apy` | Show Simple Earn APY rates |
| `bnbclaw_price` | Show a token price in USDT |
| `bnbclaw_scan` | Scan spot and funding wallets |
| `bnbclaw_convert` | Convert a spot token to USDT or BNB |
| `bnbclaw_transfer` | Move funds between spot, funding, and Earn |
| `bnbclaw_sweep` | Move idle BNB into Earn |
| `bnbclaw_dust_to_bnb` | Convert dust balances into BNB |
| `bnbclaw_buy_bnb` | Buy BNB with USDT and optionally sweep the fill into Earn |
| `bnbclaw_install_hedge_skill` | Save a custom hedge strategy from chat |
| `bnbclaw_import_hedge_skill` | Import a hedge strategy from Markdown |
| `bnbclaw_list_hedge_skills` | List installed hedge skills |
| `bnbclaw_show_hedge_skill` | Show one hedge skill in detail |
| `bnbclaw_activate_hedge_skill` | Make one hedge skill active |
| `bnbclaw_remove_hedge_skill` | Delete an installed hedge skill |

## Runtime Rules

1. Never sell BNB.
2. Idle BNB in spot or funding is swept into Simple Earn Flexible.
3. Launchpool and HODLer rewards are auto-converted to USDT when possible.
4. Dust balances can be converted to BNB without touching recent auto-convert reward assets.

## Custom Hedge Skills

BNBClaw can store hedge playbooks so the assistant is not locked to one risk style.

- Use `bnbclaw_install_hedge_skill` to save a strategy name, description, and instructions directly from chat.
- Use `bnbclaw_import_hedge_skill` to import a hedge strategy from a local `.md` file, pasted Markdown, or a GitHub/raw Markdown URL.
- Use `bnbclaw_activate_hedge_skill` to switch between installed hedge styles.
- Use `bnbclaw_list_hedge_skills` and `bnbclaw_show_hedge_skill` to review them.

The active hedge skill is injected into the assistant prompt for hedge-related planning and future automation work. It does not override hard safety rules like never selling spot BNB, and it does not place hedge trades by itself.

Example import flow:

```text
Use bnbclaw_import_hedge_skill with url=https://github.com/example/repo/blob/main/skills/funding-aware-hedge.md
```

Example Markdown format:

```md
---
title: Funding Aware Hedge
description: Partial short only when funding is favorable.
---

# Funding Aware Hedge

Use a smaller hedge while BNB stays above the medium-term trend.

## Entry

- Hedge 25% when drawdown exceeds 8%.
- Hedge 40% when drawdown exceeds 15%.

## Risk

- Use isolated margin.
- Never hedge more than 50% of BNB exposure.
```

## Heartbeat

| Task | Interval | Purpose |
|------|----------|---------|
| `scheduled-jobs` | 30s | Run due event reminders |
| `reward-check` | 30m | Sweep idle BNB and sync reward conversions |
| `dust-cleanup` | 7d | Convert eligible dust balances to BNB |

## Development

```bash
npm install
npm test
npm run build
```
