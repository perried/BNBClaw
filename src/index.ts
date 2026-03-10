import dotenv from 'dotenv';
dotenv.config();

import { BinanceClient } from './api/binance-client.js';
import { BinanceWs } from './api/binance-ws.js';
import { WebhookServer } from './api/webhook-server.js';
import { TelegramBot } from './api/telegram.js';
import { LlmRouter } from './api/llm-router.js';
import { EarnManager } from './core/earn-manager.js';
import { EventScheduler } from './core/event-scheduler.js';
import { TradeEngine } from './core/trade-engine.js';
import { RiskManager } from './core/risk-manager.js';
import { HedgeManager } from './core/hedge-manager.js';
import { Strategy } from './core/strategy.js';
import { Accumulator } from './core/accumulator.js';
import { HeartbeatScheduler, registerHeartbeats } from './heartbeat/scheduler.js';
import { statusSkill } from './skills/status.js';
import { earnStatusSkill, moveBnbToEarnSkill } from './skills/earn.js';
import { tradeHistorySkill } from './skills/trade.js';
import { rewardHistorySkill } from './skills/rewards.js';
import { showSettingsSkill, updateSettingSkill } from './skills/settings.js';
import { hedgeStatusSkill } from './skills/hedge.js';
import { getEnvConfig, getSettings } from './config/settings.js';
import { getDb, closeDb } from './db/database.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('main');

// ── Main ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const env = getEnvConfig();

  if (!env.binanceApiKey || !env.binanceApiSecret) {
    log.error('Missing BINANCE_API_KEY or BINANCE_API_SECRET in .env');
    process.exit(1);
  }

  // Initialize DB
  getDb();
  log.info('Database initialized');

  // Initialize Telegram bot
  const telegram = new TelegramBot(
    env.telegramBotToken,
    env.telegramChatId
  );

  // Auto-detect chat ID if not configured
  if (env.telegramBotToken && !env.telegramChatId) {
    const detected = await telegram.detectChatId();
    if (detected) {
      (telegram as any).chatId = detected;
      log.info(`Telegram chat ID auto-detected: ${detected}`);
    } else {
      log.warn('Telegram: no chat ID and no messages found. Send a message to the bot first.');
    }
  }

  function notify(msg: string): void {
    log.info(`[NOTIFY] ${msg}`);
    telegram.send(msg).catch(() => {});
  }

  // Create core instances
  const client = new BinanceClient(env.binanceApiKey, env.binanceApiSecret);
  const ws = new BinanceWs(client);
  const earnManager = new EarnManager(client, notify);
  const eventScheduler = new EventScheduler(notify);
  const tradeEngine = new TradeEngine(client, notify);
  const riskManager = new RiskManager(client, notify);
  const hedgeManager = new HedgeManager(client, notify);
  const strategy = new Strategy(client);
  const accumulator = new Accumulator(client, notify);

  // Wire up WebSocket events
  ws.on('balanceUpdate', async (event: { asset: string; delta: number }) => {
    await earnManager.onBalanceUpdate(event.asset, event.delta);
  });

  ws.on('orderUpdate', async (event: { status: string; realizedProfit: number }) => {
    if (event.status === 'FILLED') {
      log.info('Futures order filled', event);
    }
  });

  ws.on('connected', (label: string) => log.info(`WebSocket connected: ${label}`));
  ws.on('disconnected', (label: string) => log.warn(`WebSocket disconnected: ${label}`));
  ws.on('error', (err: any) => log.error('WebSocket error', err));

  // Start WebSocket streams (non-fatal if blocked)
  try {
    await ws.start();
    log.info('WebSocket streams started');
  } catch (err) {
    log.warn('WebSocket streams failed to start — running in polling-only mode', err);
    notify('⚠️ WebSocket streams unavailable. Reward detection will use polling fallback (every 30 min).');
  }

  // Start webhook server (if configured)
  const settings = getSettings();
  if (env.webhookSecret && settings.webhook_enabled) {
    const webhook = new WebhookServer(env.webhookSecret, env.webhookPort);

    webhook.onSignal(async (signal) => {
      const mode = await riskManager.getMode();
      if (mode === 'PASSIVE') {
        notify('🔴 Webhook signal received but trading is paused (USDT below floor).');
        return;
      }

      if (signal.direction === 'CLOSE') {
        await tradeEngine.closeAllTrades();
        return;
      }

      const size = await riskManager.calculateSize();
      if (size > 0) {
        await tradeEngine.openTrade(signal.direction, size);
      }
    });

    webhook.start();
    log.info(`Webhook server started on port ${env.webhookPort}`);
  }

  // Start heartbeat
  const heartbeat = new HeartbeatScheduler();
  registerHeartbeats(heartbeat, {
    earnManager,
    eventScheduler,
    hedgeManager,
    riskManager,
  });
  heartbeat.start();
  log.info('Heartbeat scheduler started');

  // Initial sweep — make sure BNB is in Simple Earn
  try {
    await earnManager.heartbeat();
  } catch (err) {
    log.warn('Initial earn sweep failed — will retry on next heartbeat', err);
  }

  // Set up LLM router — all Telegram messages route through the LLM
  if (!env.llmApiKey) {
    log.warn('LLM_API_KEY not set — Telegram messaging disabled. Set it in .env to enable.');
  } else {
    const llm = new LlmRouter({
      apiKey: env.llmApiKey,
      baseUrl: env.llmBaseUrl,
      model: env.llmModel,
    });

    llm.registerTool('status', async () =>
      statusSkill({ client, riskManager, hedgeManager, tradeEngine })
    );
    llm.registerTool('earn', async () =>
      earnStatusSkill({ client })
    );
    llm.registerTool('rewards', async (args: { days?: number }) =>
      rewardHistorySkill(args.days ?? 30)
    );
    llm.registerTool('trades', async () =>
      tradeHistorySkill()
    );
    llm.registerTool('hedge', async () =>
      hedgeStatusSkill({ hedgeManager })
    );
    llm.registerTool('settings', async () =>
      showSettingsSkill()
    );
    llm.registerTool('sweep', async () =>
      moveBnbToEarnSkill({ client, earnManager })
    );
    llm.registerTool('update_setting', async (args: { key: string; value: number }) =>
      updateSettingSkill(args.key as any, args.value)
    );

    telegram.setLlmRouter(llm);
    log.info(`LLM brain active: ${env.llmModel} via ${env.llmBaseUrl}`);
  }

  // Start polling for Telegram messages
  telegram.startPolling();

  notify('🦞 BNBClaw is online! Type "status" to see your portfolio.');

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    telegram.stopPolling();
    heartbeat.stop();
    ws.stop();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  log.error('Fatal error', err);
  process.exit(1);
});
