import dotenv from 'dotenv';
dotenv.config();

import { BinanceClient } from './api/binance-client.js';
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
import { resolveCredentials, hasBinanceCredentials } from './utils/keystore.js';
import { createLogger } from './utils/logger.js';

const log = createLogger('main');

let heartbeat: HeartbeatScheduler | null = null;

// ── Boot Agent ────────────────────────────────────────────
// Called once Binance keys are available (either from .env or chat setup).

async function bootAgent(telegram: TelegramBot): Promise<void> {
  const env = getEnvConfig();
  const creds = resolveCredentials();

  if (!creds.binanceApiKey || !creds.binanceApiSecret) {
    log.warn('Cannot boot agent — Binance credentials not available');
    return;
  }

  function notify(msg: string): void {
    log.info(`[NOTIFY] ${msg}`);
    telegram.send(msg).catch(() => {});
  }

  // Create core instances
  const client = new BinanceClient(creds.binanceApiKey, creds.binanceApiSecret);
  const earnManager = new EarnManager(client, notify);
  const eventScheduler = new EventScheduler(notify);
  const tradeEngine = new TradeEngine(client, notify);
  const riskManager = new RiskManager(client, notify);
  const hedgeManager = new HedgeManager(client, notify);
  const strategy = new Strategy(client);
  const accumulator = new Accumulator(client, notify);

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
  heartbeat = new HeartbeatScheduler();
  registerHeartbeats(heartbeat, {
    earnManager,
    eventScheduler,
    hedgeManager,
    riskManager,
  });
  heartbeat.start();
  log.info('Heartbeat scheduler started');

  // Initial sweep
  try {
    await earnManager.heartbeat();
  } catch (err) {
    log.warn('Initial earn sweep failed — will retry on next heartbeat', err);
  }

  // Set up LLM router
  const llmApiKey = creds.llmApiKey;
  if (!llmApiKey) {
    log.warn('LLM_API_KEY not set — AI chat disabled. Use /setup to add it.');
  } else {
    const llm = new LlmRouter({
      apiKey: llmApiKey,
      baseUrl: env.llmBaseUrl,
      model: env.llmModel,
    });

    llm.registerTool('status', async () =>
      statusSkill({ client, riskManager, hedgeManager, tradeEngine })
    );
    llm.registerTool('earn', async () =>
      earnStatusSkill({ client })
    );
    llm.registerTool('rewards', async (args) =>
      rewardHistorySkill(client, (args.days as number) ?? 30)
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
    llm.registerTool('update_setting', async (args) =>
      updateSettingSkill(args.key as keyof import('./api/types.js').Settings, args.value as number)
    );
    telegram.setLlmRouter(llm);
    log.info(`LLM brain active: ${env.llmModel} via ${env.llmBaseUrl}`);
  }

  notify('🦞 BNBClaw is online! Type "status" to see your portfolio.');
}

// ── Main ─────────────────────────────────────────────────

async function main(): Promise<void> {
  const env = getEnvConfig();

  if (!env.telegramBotToken) {
    log.error('TELEGRAM_BOT_TOKEN is required in .env — get one from @BotFather on Telegram');
    process.exit(1);
  }

  // Initialize DB (needed for keystore + setup)
  getDb();
  log.info('Database initialized');

  // Initialize Telegram bot
  const telegram = new TelegramBot(env.telegramBotToken, env.telegramChatId);

  // Auto-detect chat ID if not configured
  if (!env.telegramChatId) {
    const detected = await telegram.detectChatId();
    if (detected) {
      telegram.setChatId(detected);
      log.info(`Telegram chat ID auto-detected: ${detected}`);
    }
  }

  // Register setup completion callback
  telegram.onSetup(async () => {
    log.info('Setup complete — booting agent...');
    await bootAgent(telegram);
  });

  // Start polling immediately — works for both setup flow and normal operation
  telegram.startPolling();

  // If keys are already available, boot the agent right away
  if (hasBinanceCredentials()) {
    log.info('Binance credentials found — booting agent');
    await bootAgent(telegram);
  } else {
    log.info('No Binance credentials — waiting for chat setup. Send /start to the bot.');
  }

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    telegram.stopPolling();
    if (heartbeat) heartbeat.stop();
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
