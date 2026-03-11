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
import { BinanceWs } from './binance-ws.js';
import { AnnouncementMonitor } from '../core/announcement-monitor.js';
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
import { announcementHistorySkill } from '../skills/announcements.js';
import { hedgeStatusSkill } from '../skills/hedge.js';
import { apySkill } from '../skills/apy.js';
import { getEnvConfig, getSettings } from '../config/settings.js';
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
    const ws = new BinanceWs(client);
    const earnManager = new EarnManager(client, notify);
    const eventScheduler = new EventScheduler(notify);
    const tradeEngine = new TradeEngine(client, notify);
    const riskManager = new RiskManager(client, notify);
    const hedgeManager = new HedgeManager(client, notify);
    const strategy = new Strategy(client);
    const accumulator = new Accumulator(client, notify);
    const announcementMonitor = new AnnouncementMonitor(notify);

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
      description: 'Show current hedge status: active/inactive, short size, hedge ratio, unrealized PnL',
      parameters: Type.Object({}),
      async execute() {
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
      name: 'bnbclaw_announcements',
      label: 'BNBClaw Announcements',
      description: 'Show Binance announcements stored in local DB. Only contains announcements seen since BNBClaw started monitoring. For historical reward data, use bnbclaw_rewards instead.',
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: 'Number of announcements to show (default 10)' })),
      }),
      async execute(_toolCallId: string, params: { limit?: number }) {
        const text = await announcementHistorySkill(client, params.limit ?? 10);
        return textResult(text);
      },
    });

    api.registerTool({
      name: 'bnbclaw_apy',
      label: 'BNBClaw APY Rates',
      description: 'LIVE from Binance API: Show Simple Earn APY rates for flexible and locked products. Optionally filter by asset.',
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
        const symbol = (params.symbol || 'BNBUSDT').toUpperCase();
        try {
          const price = await client.getPrice(symbol);
          return textResult(`${symbol}: $${price}`);
        } catch (err: any) {
          return textResult(`Failed to get price for ${symbol}: ${err.message}`);
        }
      },
    });

    // Mutating tools — ownerOnly so only the account owner can execute
    api.registerTool({
      name: 'bnbclaw_sweep',
      label: 'BNBClaw Sweep',
      description: 'Move idle BNB from spot wallet into Simple Earn Flexible',
      ownerOnly: true,
      parameters: Type.Object({}),
      async execute() {
        const text = await moveBnbToEarnSkill({ client, earnManager });
        return textResult(text);
      },
    });

    api.registerTool({
      name: 'bnbclaw_update_setting',
      label: 'BNBClaw Update Setting',
      description: 'Update a setting. Valid keys: usdt_floor, leverage, risk_per_trade, bnb_buy_threshold, hedge_ratio',
      ownerOnly: true,
      parameters: Type.Object({
        key: Type.String({ description: 'Setting key to update' }),
        value: Type.Number({ description: 'The new value for the setting' }),
      }),
      async execute(_toolCallId: string, params: { key: string; value: number }) {
        const validKeys = ['usdt_floor', 'leverage', 'risk_per_trade', 'bnb_buy_threshold', 'hedge_ratio'];
        if (!validKeys.includes(params.key)) {
          return textResult(`Invalid key "${params.key}". Valid keys: ${validKeys.join(', ')}`);
        }
        const text = updateSettingSkill(params.key as any, params.value);
        return textResult(text);
      },
    });

    api.registerTool({
      name: 'bnbclaw_scan',
      label: 'BNBClaw Scan Balances',
      description: 'Scan spot and funding wallets for idle tokens, dust, or unconverted airdrop tokens. Shows what can be converted.',
      ownerOnly: true,
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
      ownerOnly: true,
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
        } catch (err: any) {
          return textResult(`Failed to convert ${asset}: ${err.message}`);
        }
      },
    });

    api.registerTool({
      name: 'bnbclaw_transfer',
      label: 'BNBClaw Transfer',
      description: 'Transfer tokens between wallets. Types: spot, funding, futures, earn.',
      ownerOnly: true,
      parameters: Type.Object({
        asset: Type.String({ description: 'Token to transfer (e.g. BNB, USDT)' }),
        amount: Type.Number({ description: 'Amount to transfer' }),
        from: Type.String({ description: 'Source: spot, funding, futures' }),
        to: Type.String({ description: 'Destination: spot, funding, futures, earn' }),
      }),
      async execute(_toolCallId: string, params: { asset: string; amount: number; from: string; to: string }) {
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

    // ── TradingView Webhook Route ─────────────────────────

    const settings = getSettings();
    if (keys.webhookSecret && settings.webhook_enabled) {
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
      announcementMonitor,
      earnManager,
      eventScheduler,
      hedgeManager,
      riskManager,
    });

    api.registerService({
      id: 'bnbclaw-agent',
      async start() {
        // Start WebSocket streams (non-fatal if blocked)
        try {
          await ws.start();
          logger.info('WebSocket streams started');
        } catch {
          logger.warn('WebSocket streams failed — running in polling-only mode');
        }

        // Wire WebSocket events
        ws.on('balanceUpdate', async (event: { asset: string; delta: number }) => {
          await earnManager.onBalanceUpdate(event.asset, event.delta);
        });

        // Start heartbeat scheduler
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
        ws.stop();
        closeDb();
        logger.info('🦞 BNBClaw agent service stopped');
      },
    });

    // ── Lifecycle Hooks ───────────────────────────────────

    // Inject BNBClaw identity into every LLM call
    const BNBCLAW_PROMPT = [
      'You are BNBClaw 🦞, a BNB accumulation AI agent.',
      'CRITICAL: NEVER output a startup script, initialization sequence, boot animation, or "Available Commands" list.',
      'On /start or greeting, reply with ONE short sentence only. Example: "Hey! What do you need?"',
      'RULES: Never sell BNB. Always use bnbclaw_* tools for data — never guess.',
      'STYLE: Be SHORT. 2-4 lines max. No bullet lists. No emoji spam. No motivational text. Just data.',
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

    logger.info('🦞 BNBClaw plugin registered — 13 tools, 1 service, 1 route');
  },
};

export default plugin;
