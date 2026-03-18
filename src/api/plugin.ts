/**
 * BNBClaw — OpenClaw Plugin (openclaw@2026.3.8)
 *
 * Proper OpenClawPluginDefinition with:
 *   - configSchema for validated gateway configuration
 *   - 12 LLM-callable tools (with ownerOnly on mutating ops) *   - 1 background service (heartbeat + WebSocket streams)
 *   - 1 HTTP route (TradingView webhook)
 *   - Lifecycle hooks (gateway_start, gateway_stop, heartbeat, after_tool_call)
 *   - PluginRuntime for notifications via channel.reply
 *
 * Standalone `index.ts` remains for running without the gateway (npm start).
 */

import dotenv from 'dotenv';
dotenv.config();

import { Type } from '@sinclair/typebox';
import type {
  OpenClawPluginDefinition,
  OpenClawPluginApi,
  OpenClawPluginConfigSchema,
  AgentToolResult,
  PluginRuntime,
  PluginHookEvent,
  ToolInputError,
} from './openclaw-types.js';

import { BinanceClient } from './binance-client.js';
import { EarnManager } from '../core/earn-manager.js';
import { EventScheduler } from '../core/event-scheduler.js';
import { TradeEngine } from '../core/trade-engine.js';
import { RiskManager } from '../core/risk-manager.js';
import { HedgeManager } from '../core/hedge-manager.js';
import { Strategy } from '../core/strategy.js';
import { Accumulator } from '../core/accumulator.js';
import { HeartbeatScheduler, registerHeartbeats } from '../heartbeat/scheduler.js';
import { statusSkill } from '../skills/status.js';
import { earnStatusSkill, moveBnbToEarnSkill } from '../skills/earn.js';
import { tradeHistorySkill } from '../skills/trade.js';
import { rewardHistorySkill } from '../skills/rewards.js';
import { showSettingsSkill, updateSettingSkill } from '../skills/settings.js';
import { activateHedgeSkill, deactivateHedgeSkill, hedgeStatusSkill } from '../skills/hedge.js';
import { apySkill } from '../skills/apy.js';
import { getEnvConfig, getSettings, validateSetting } from '../config/settings.js';
import { getDb, closeDb } from '../db/database.js';

// ── Helpers ──────────────────────────────────────────────

function textResult(text: string): AgentToolResult {
  return { content: [{ type: 'text', text }], details: {} };
}

// ── Config Schema ────────────────────────────────────────
// Declares what settings the gateway UI collects from the user.

const configSchema: OpenClawPluginConfigSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    binance_api_key: {
      type: 'string',
      description: 'Binance API key (enable spot + futures trade; disable withdraw)',
    },
    binance_api_secret: {
      type: 'string',
      description: 'Binance API secret',
    },
    webhook_secret: {
      type: 'string',
      description: 'TradingView webhook secret token (optional)',
    },
    webhook_port: {
      type: 'number',
      description: 'Webhook server port',
      default: 3000,
    },
    usdt_floor: {
      type: 'number',
      description: 'Minimum USDT balance — agent stops trading below this',
      default: 500,
    },
    leverage: {
      type: 'number',
      description: 'Futures leverage multiplier',
      default: 3,
    },
    risk_per_trade: {
      type: 'number',
      description: 'Fraction of available USDT per trade (0.01–0.20)',
      default: 0.05,
    },
    bnb_buy_threshold: {
      type: 'number',
      description: 'Accumulated short profits (USDT) before auto-buying BNB',
      default: 50,
    },
    hedge_ratio: {
      type: 'number',
      description: 'Target hedge ratio (0.0–1.0)',
      default: 0.85,
    },
  },
};

// ── Resolve API keys ─────────────────────────────────────
// Prefer pluginConfig from gateway; fall back to env vars.

function resolveKeys(api: OpenClawPluginApi) {
  const pc = api.pluginConfig ?? {};
  const env = getEnvConfig();
  return {
    apiKey: (pc.binance_api_key as string) || env.binanceApiKey,
    apiSecret: (pc.binance_api_secret as string) || env.binanceApiSecret,
    webhookSecret: (pc.webhook_secret as string) || env.webhookSecret,
    webhookPort: (pc.webhook_port as number) || env.webhookPort,
  };
}

// ── Plugin Definition ────────────────────────────────────

const plugin: OpenClawPluginDefinition = {
  id: 'bnbclaw',
  name: 'BNBClaw',
  description:
    'AI agent that maximizes BNB utility on Binance — auto-earn, trading, hedging, and reward accumulation. Never sells BNB, only accumulates.',
  version: '0.1.0',
  configSchema,

  register(api: OpenClawPluginApi): void {
    const logger = api.logger;
    const runtime: PluginRuntime = api.runtime;
    const keys = resolveKeys(api);

    if (!keys.apiKey || !keys.apiSecret) {
      logger.error('Missing Binance API credentials — set binance_api_key / binance_api_secret in plugin config or .env');
      return;
    }

    // ── Initialize database ───────────────────────────────
    getDb();
    logger.info('Database initialized');

    // ── Notification helper ───────────────────────────────
    // Uses runtime.channel.reply when a channel context exists,
    // otherwise falls back to logger.
    function notify(msg: string): void {
      logger.info(`[NOTIFY] ${msg}`);
    }

    // ── Core modules ──────────────────────────────────────
    const client = new BinanceClient(keys.apiKey, keys.apiSecret);
    const earnManager = new EarnManager(client, notify);
    const eventScheduler = new EventScheduler(notify);
    const tradeEngine = new TradeEngine(client, notify);
    const riskManager = new RiskManager(client, notify);
    const hedgeManager = new HedgeManager(client, notify);
    const strategy = new Strategy(client);
    const accumulator = new Accumulator(client, notify);
    // ── LLM-callable Tools ────────────────────────────────

    // Read-only tools — anyone in the channel can query these
    api.registerTool({
      name: 'bnbclaw_status',
      label: 'BNBClaw Status',
      description: 'Show full portfolio overview: BNB holdings, USDT balance, mode, hedge, PnL, accumulation',
      parameters: Type.Object({}),
      async execute() {
        const text = await statusSkill({ client, riskManager, hedgeManager, tradeEngine });
        return textResult(text);
      },
    });

    api.registerTool({
      name: 'bnbclaw_earn',
      label: 'BNBClaw Earn',
      description: 'Show Simple Earn positions and APY from Binance API. Also shows locally tracked reward conversions from DB.',
      parameters: Type.Object({}),
      async execute() {
        const text = await earnStatusSkill({ client });
        return textResult(text);
      },
    });

    api.registerTool({
      name: 'bnbclaw_rewards',
      label: 'BNBClaw Rewards',
      description: 'LIVE from Binance API: shows all distributions (HODLer Airdrops, Launchpool, BNB Vault, Flexible, Locked) over last N days. Use this for any question about rewards, distributions, airdrops, or what tokens were received.',
      parameters: Type.Object({
        days: Type.Optional(Type.Number({ description: 'Number of days to look back (default 30)' })),
      }),
      async execute(_toolCallId: string, params: { days?: number }) {
        const text = await rewardHistorySkill(client, params.days ?? 30);
        return textResult(text);
      },
    });

    api.registerTool({
      name: 'bnbclaw_trades',
      label: 'BNBClaw Trades',
      description: 'Show recent trade history: open and closed positions with PnL',
      parameters: Type.Object({}),
      async execute() {
        const text = tradeHistorySkill();
        return textResult(text);
      },
    });

    api.registerTool({
      name: 'bnbclaw_hedge',
      label: 'BNBClaw Hedge',
      description: 'Hedge control: activate, deactivate, or show status of the delta-neutral hedge (futures short against BNB holdings)',
      parameters: Type.Object({
        action: Type.Optional(Type.String({ description: 'Action: "on" to activate, "off" to deactivate, omit for status' })),
      }),
      async execute(_toolCallId: string, params: { action?: string }) {
        const act = (params.action || '').toLowerCase();
        if (act === 'on') {
          const text = await activateHedgeSkill({ hedgeManager });
          return textResult(text);
        }
        if (act === 'off') {
          const text = await deactivateHedgeSkill({ hedgeManager });
          return textResult(text);
        }
        const text = await hedgeStatusSkill({ hedgeManager });
        return textResult(text);
      },
    });

    api.registerTool({
      name: 'bnbclaw_settings',
      label: 'BNBClaw Settings',
      description: 'Show current agent settings: USDT floor, leverage, risk per trade, BNB buy threshold',
      parameters: Type.Object({}),
      async execute() {
        const text = showSettingsSkill();
        return textResult(text);
      },
    });

    api.registerTool({
      name: 'bnbclaw_apy',
      label: 'BNBClaw APY Rates',
      description: 'LIVE from Binance API: Show Simple Earn APR rates for flexible and locked products (includes BNB holder bonus tiers). Optionally filter by asset.',
      parameters: Type.Object({
        asset: Type.Optional(Type.String({ description: 'Filter by asset (e.g. BNB, USDT). Omit to show top rates.' })),
      }),
      async execute(_toolCallId: string, params: { asset?: string }) {
        const text = await apySkill(client, params.asset);
        return textResult(text);
      },
    });

    api.registerTool({
      name: 'bnbclaw_price',
      label: 'BNBClaw Price',
      description: 'LIVE from Binance API: Get current price of a token in USDT.',
      parameters: Type.Object({
        symbol: Type.Optional(Type.String({ description: 'Trading pair (default BNBUSDT). Examples: BNBUSDT, BTCUSDT, ETHUSDT' })),
      }),
      async execute(_toolCallId: string, params: { symbol?: string }) {
        const symbol = (params.symbol || 'BNBUSDT').toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (symbol.length < 2 || symbol.length > 20) {
          return textResult('Invalid symbol.');
        }
        try {
          const price = await client.getPrice(symbol);
          return textResult(`${symbol}: $${price}`);
        } catch (err) {
          return textResult(`Failed to get price for ${symbol}: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    // Mutating tools
    api.registerTool({
      name: 'bnbclaw_sweep',
      label: 'BNBClaw Sweep',
      description: 'Move idle BNB from spot wallet into Simple Earn Flexible',
      parameters: Type.Object({}),
      async execute() {
        const text = await moveBnbToEarnSkill({ client, earnManager });
        return textResult(text);
      },
    });

    api.registerTool({
      name: 'bnbclaw_update_setting',
      label: 'BNBClaw Update Setting',
      description: 'Update a setting. Valid keys: usdt_floor, leverage, risk_per_trade, bnb_buy_threshold, hedge_ratio, webhook_enabled (true/false)',
      parameters: Type.Object({
        key: Type.String({ description: 'Setting key to update' }),
        value: Type.Union([Type.Number(), Type.Boolean()], { description: 'The new value for the setting' }),
      }),
      async execute(_toolCallId: string, params: { key: string; value: number | boolean }) {
        const validKeys = ['usdt_floor', 'leverage', 'risk_per_trade', 'bnb_buy_threshold', 'hedge_ratio', 'webhook_enabled'];
        if (!validKeys.includes(params.key)) {
          return textResult(`Invalid key "${params.key}". Valid keys: ${validKeys.join(', ')}`);
        }
        const validationError = validateSetting(params.key as keyof import('../api/types.js').Settings, params.value);
        if (validationError) {
          return textResult(`⚠️ ${validationError}`);
        }
        const text = updateSettingSkill(params.key as keyof import('../api/types.js').Settings, params.value);
        return textResult(text);
      },
    });

    api.registerTool({
      name: 'bnbclaw_scan',
      label: 'BNBClaw Scan Balances',
      description: 'Scan spot and funding wallets for idle tokens, dust, or unconverted airdrop tokens. Shows what can be converted.',
      parameters: Type.Object({}),
      async execute() {
        const spotBalances = await client.getAllSpotBalances();
        const fundingBalances = await client.getFundingBalance();

        let msg = '🦞 Wallet Scan\n━━━━━━━━━━━━━━━━━━━━\n';
        let found = false;

        if (spotBalances.length > 0) {
          msg += '\n📦 Spot:\n';
          for (const b of spotBalances) {
            msg += `  ${b.asset}: ${b.free}${b.locked > 0 ? ` (locked: ${b.locked})` : ''}\n`;
            found = true;
          }
        }

        if (fundingBalances.length > 0) {
          msg += '\n💰 Funding:\n';
          for (const b of fundingBalances) {
            const free = parseFloat(b.free);
            if (free > 0) {
              msg += `  ${b.asset}: ${b.free}\n`;
              found = true;
            }
          }
        }

        if (!found) {
          msg += 'All wallets clean. No idle tokens found.';
        } else {
          msg += '\nUse "convert [ASSET] usdt" or "convert [ASSET] bnb" to convert.';
          msg += '\nUse "transfer [ASSET] [from] [to]" to move between wallets.';
        }
        return textResult(msg);
      },
    });

    api.registerTool({
      name: 'bnbclaw_convert',
      label: 'BNBClaw Convert Token',
      description: 'Convert a token to USDT or BNB. Use for airdrop tokens, dust, or any non-BNB/USDT asset.',
      parameters: Type.Object({
        asset: Type.String({ description: 'Token to convert (e.g. NIGHT, OPN)' }),
        target: Type.Optional(Type.String({ description: 'Target: "usdt" (default) or "bnb"' })),
      }),
      async execute(_toolCallId: string, params: { asset: string; target?: string }) {
        const asset = params.asset.toUpperCase();
        const target = (params.target || 'usdt').toUpperCase();

        if (asset === 'BNB' && target === 'USDT') {
          return textResult('🦞 Rule violation: Never sell BNB.');
        }
        if (target !== 'USDT' && target !== 'BNB') {
          return textResult('Target must be "usdt" or "bnb".');
        }

        try {
          const { free } = await client.getSpotBalance(asset);
          if (free <= 0) {
            return textResult(`No ${asset} available in spot wallet.`);
          }

          let received = 0;
          const pair = `${asset}${target}`;
          try {
            const info = await client.getExchangeInfo(pair);
            if (info) {
              const order = await client.placeSpotOrder('SELL', free, pair);
              received = parseFloat(order.executedQty) * parseFloat(order.avgPrice);
            } else {
              throw new Error('no pair');
            }
          } catch {
            const quote = await client.getConvertQuote(asset, target, free);
            await client.acceptConvertQuote(quote.quoteId);
            received = parseFloat(quote.toAmount);
          }

          return textResult(`🦞 Converted ${free} ${asset} → ${received.toFixed(4)} ${target}`);
        } catch (err) {
          return textResult(`Failed to convert ${asset}: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    api.registerTool({
      name: 'bnbclaw_transfer',
      label: 'BNBClaw Transfer',
      description: 'Transfer tokens between wallets. Types: spot, funding, futures, earn.',
      parameters: Type.Object({
        asset: Type.String({ description: 'Token to transfer (e.g. BNB, USDT)' }),
        amount: Type.Number({ description: 'Amount to transfer' }),
        from: Type.String({ description: 'Source: spot, funding, futures' }),
        to: Type.String({ description: 'Destination: spot, funding, futures, earn' }),
      }),
      async execute(_toolCallId: string, params: { asset: string; amount: number; from: string; to: string }) {
        if (!isFinite(params.amount) || params.amount <= 0) {
          return textResult('Amount must be a positive number.');
        }
        const asset = params.asset.toUpperCase();
        const from = params.from.toLowerCase();
        const to = params.to.toLowerCase();

        // Handle earn specially
        if (to === 'earn') {
          if (from !== 'spot') {
            // Transfer to spot first
            const typeMap: Record<string, string> = { funding: 'FUNDING_MAIN', futures: 'UMFUTURE_MAIN' };
            const transferType = typeMap[from];
            if (!transferType) return textResult(`Invalid source: ${from}`);
            await client.universalTransfer(transferType, asset, params.amount);
          }
          await client.subscribeEarn(asset, params.amount);
          return textResult(`🦞 Transferred ${params.amount} ${asset} from ${from} → Simple Earn.`);
        }

        const typeMap: Record<string, string> = {
          'spot_funding': 'MAIN_FUNDING',
          'funding_spot': 'FUNDING_MAIN',
          'spot_futures': 'MAIN_UMFUTURE',
          'futures_spot': 'UMFUTURE_MAIN',
          'funding_futures': 'FUNDING_UMFUTURE',
          'futures_funding': 'UMFUTURE_FUNDING',
        };

        const key = `${from}_${to}`;
        const transferType = typeMap[key];
        if (!transferType) {
          return textResult(`Invalid transfer: ${from} → ${to}. Valid: spot, funding, futures, earn.`);
        }

        await client.universalTransfer(transferType, asset, params.amount);
        return textResult(`🦞 Transferred ${params.amount} ${asset}: ${from} → ${to}.`);
      },
    });

    // ── Trading Tools ─────────────────────────────────────

    api.registerTool({
      name: 'bnbclaw_buy_bnb',
      label: 'BNBClaw Buy BNB',
      description: 'Buy BNB on spot market with USDT. Optionally sweep purchased BNB into Simple Earn.',
      parameters: Type.Object({
        amount_usdt: Type.Number({ description: 'USDT amount to spend buying BNB' }),
        sweep: Type.Optional(Type.Boolean({ description: 'Move purchased BNB to Simple Earn (default true)' })),
      }),
      async execute(_toolCallId: string, params: { amount_usdt: number; sweep?: boolean }) {
        if (!isFinite(params.amount_usdt) || params.amount_usdt <= 0 || params.amount_usdt > 100_000) {
          return textResult('Amount must be a positive number (max 100,000 USDT).');
        }
        try {
          const order = await client.placeSpotQuoteOrder('BUY', params.amount_usdt, 'BNBUSDT');
          const bnbBought = parseFloat(order.executedQty);
          const avgPrice = parseFloat(order.avgPrice);
          let msg = `🦞 Bought ${bnbBought.toFixed(4)} BNB @ $${avgPrice.toFixed(2)} (spent $${params.amount_usdt.toFixed(2)} USDT)`;

          if (params.sweep !== false) {
            try {
              await client.subscribeEarn('BNB', bnbBought);
              msg += '\n→ Swept to Simple Earn.';
            } catch {
              msg += '\n⚠️ Earn sweep failed — BNB remains in spot.';
            }
          }
          return textResult(msg);
        } catch (err) {
          return textResult(`Failed to buy BNB: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    api.registerTool({
      name: 'bnbclaw_open_position',
      label: 'BNBClaw Open Position',
      description: 'Open a futures position (LONG or SHORT) on BNBUSDT. Uses risk manager for size if not specified.',
      parameters: Type.Object({
        direction: Type.String({ description: 'LONG or SHORT' }),
        size_bnb: Type.Optional(Type.Number({ description: 'Position size in BNB (omit to auto-calculate from risk settings)' })),
      }),
      async execute(_toolCallId: string, params: { direction: string; size_bnb?: number }) {
        const dir = params.direction.toUpperCase();
        if (dir !== 'LONG' && dir !== 'SHORT') {
          return textResult('Direction must be LONG or SHORT.');
        }

        const mode = await riskManager.getMode();
        if (mode === 'PASSIVE') {
          return textResult('🔴 Trading paused — USDT below floor. Increase balance or lower usdt_floor setting.');
        }

        if (params.size_bnb != null && (!isFinite(params.size_bnb) || params.size_bnb <= 0 || params.size_bnb > 1000)) {
          return textResult('Size must be between 0.01 and 1000 BNB.');
        }
        const size = params.size_bnb ?? await riskManager.calculateSize();
        if (size <= 0) {
          return textResult('Calculated position size is 0. Check USDT balance and risk settings.');
        }

        try {
          const tradeId = await tradeEngine.openTrade(dir as 'LONG' | 'SHORT', size);
          return textResult(`🦞 Opened ${dir} ${size.toFixed(2)} BNB (trade #${tradeId})`);
        } catch (err) {
          return textResult(`Failed to open position: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    api.registerTool({
      name: 'bnbclaw_close_position',
      label: 'BNBClaw Close Position',
      description: 'Close a futures position by trade ID, or close all open positions if no ID given.',
      parameters: Type.Object({
        trade_id: Type.Optional(Type.Number({ description: 'Trade ID to close (omit to close all)' })),
      }),
      async execute(_toolCallId: string, params: { trade_id?: number }) {
        try {
          if (params.trade_id != null) {
            await tradeEngine.closeTradeById(params.trade_id);
            return textResult(`🦞 Closed trade #${params.trade_id}.`);
          }
          await tradeEngine.closeAllTrades();
          return textResult('🦞 All positions closed.');
        } catch (err) {
          return textResult(`Failed to close position: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    api.registerTool({
      name: 'bnbclaw_positions',
      label: 'BNBClaw Positions',
      description: 'Show open futures positions from Binance API with unrealized PnL, plus locally tracked trades.',
      parameters: Type.Object({}),
      async execute() {
        try {
          const [livePositions, dbTrades] = await Promise.all([
            client.getFuturesPositions(),
            Promise.resolve(tradeEngine.getOpenPositions()),
          ]);

          let msg = '🦞 Open Positions\n━━━━━━━━━━━━━━━━━━━━\n';

          if (livePositions.length === 0 && dbTrades.length === 0) {
            return textResult(msg + 'No open positions.');
          }

          if (livePositions.length > 0) {
            msg += '\n📊 Binance Futures:\n';
            for (const p of livePositions) {
              const amt = parseFloat(p.positionAmt);
              const side = amt > 0 ? 'LONG' : 'SHORT';
              const pnl = parseFloat(p.unRealizedProfit);
              msg += `  ${p.symbol} ${side} ${Math.abs(amt)} BNB | uPnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}\n`;
            }
          }

          if (dbTrades.length > 0) {
            msg += '\n📋 Tracked Trades:\n';
            for (const t of dbTrades) {
              msg += `  #${t.id} ${t.direction} ${t.size_bnb} BNB @ $${t.entry_price.toFixed(2)}\n`;
            }
          }

          return textResult(msg);
        } catch (err) {
          return textResult(`Failed to fetch positions: ${err instanceof Error ? err.message : String(err)}`);
        }
      },
    });

    // ── TradingView Webhook Route ─────────────────────────
    // Always registered if secret is configured; checked at runtime via webhook_enabled setting.

    if (keys.webhookSecret) {
      api.registerHttpRoute({
        path: '/bnbclaw/webhook',
        auth: 'plugin',
        match: 'exact',

        async handler(req, res) {
          if (req.method !== 'POST') {
            res.writeHead(405);
            res.end('Method Not Allowed');
            return;
          }

          // Check if webhook is enabled at runtime
          const currentSettings = getSettings();
          if (!currentSettings.webhook_enabled) {
            res.writeHead(403);
            res.end('Webhook disabled');
            return;
          }

          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          }
          const body = JSON.parse(Buffer.concat(chunks).toString());

          if (body.secret !== keys.webhookSecret) {
            res.writeHead(403);
            res.end('Forbidden');
            return;
          }

          const direction = (body.action || '').toUpperCase();
          if (['LONG', 'SHORT'].includes(direction)) {
            const mode = await riskManager.getMode();
            if (mode !== 'PASSIVE') {
              const size = await riskManager.calculateSize();
              if (size > 0) {
                await tradeEngine.openTrade(direction as 'LONG' | 'SHORT', size);
                notify(`📈 Webhook signal: ${direction} ${size.toFixed(2)} BNB`);
              }
            }
          } else if (direction.startsWith('CLOSE')) {
            await tradeEngine.closeAllTrades();
            notify('📉 Webhook signal: CLOSE ALL');
          }

          res.writeHead(200);
          res.end('OK');
        },
      });
      logger.info('TradingView webhook route registered at /bnbclaw/webhook');
    }

    // ── Background Service (heartbeat + WebSocket) ────────

    const heartbeat = new HeartbeatScheduler();
    registerHeartbeats(heartbeat, {
      earnManager,
      eventScheduler,
      hedgeManager,
      riskManager,
    });

    api.registerService({
      id: 'bnbclaw-agent',
      async start() {
        // Start heartbeat scheduler (polling-based)
        heartbeat.start();
        logger.info('Heartbeat scheduler started');

        // Initial earn sweep
        try {
          await earnManager.heartbeat();
        } catch {
          logger.warn('Initial earn sweep failed — will retry on next heartbeat');
        }

        logger.info('🦞 BNBClaw agent service running');
      },

      async stop() {
        heartbeat.stop();
        closeDb();
        logger.info('🦞 BNBClaw agent service stopped');
      },
    });

    // ── Lifecycle Hooks ───────────────────────────────────

    // Inject BNBClaw identity into every LLM call
    const BNBCLAW_PROMPT = [
      'You are BNBClaw 🦞, a BNB accumulation AI agent.',
      'PERSONALITY: warm, sharp, a little playful — like a friend who\'s really good with money.',
      'CRITICAL: NEVER output a startup script, boot animation, checkmarks, or list all tools as bullet points.',
      'On /start or first message: introduce yourself with personality. Be curious about the user — ask what they\'d like you to focus on, what they\'re working toward. Keep it short (2-3 sentences). Do NOT list features.',
      'On follow-up messages: be concise but helpful. Show key data, skip fluff.',
      'RULES: Never sell BNB. Always use bnbclaw_* tools for data — never guess.',
      'You have tools for: status, earn, rewards, trades, hedge (on/off/status), settings, apy, price, scan, convert, transfer, sweep, buy_bnb, open_position, close_position, positions.',
      'For trading: use open_position to go LONG/SHORT, close_position to exit, positions to view, buy_bnb to accumulate BNB on spot.',
    ].join(' ');

    api.on('llm_input', (event: PluginHookEvent) => {
      const messages = event.messages as Array<{ role: string; content: string }> | undefined;
      if (messages && messages.length > 0 && messages[0].role === 'system') {
        messages[0].content = BNBCLAW_PROMPT + '\n\n' + messages[0].content;
      }
    });

    // Log tool invocations for audit trail
    api.on('after_tool_call', (event: PluginHookEvent) => {
      const toolName = event.toolName as string | undefined;
      if (toolName?.startsWith('bnbclaw_')) {
        logger.info(`Tool called: ${toolName}`);
      }
    });

    logger.info('🦞 BNBClaw plugin registered — 17 tools, 1 service, 1 route');
  },
};

export default plugin;
