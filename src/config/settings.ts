import dotenv from 'dotenv';
import { getSetting, setSetting, getAllSettings } from '../db/queries.js';
import type { Settings } from '../api/types.js';

dotenv.config();

const DEFAULTS: Settings = {
  usdt_floor: parseFloat(process.env.DEFAULT_USDT_FLOOR ?? '500'),
  leverage: parseInt(process.env.DEFAULT_LEVERAGE ?? '3', 10),
  risk_per_trade: parseFloat(process.env.DEFAULT_RISK_PER_TRADE ?? '0.05'),
  bnb_buy_threshold: parseFloat(process.env.DEFAULT_BNB_BUY_THRESHOLD ?? '50'),
  hedge_ratio: parseFloat(process.env.DEFAULT_HEDGE_RATIO ?? '0.85'),
  webhook_enabled: process.env.WEBHOOK_SECRET ? true : false,
};

export function getSettings(): Settings {
  const stored = getAllSettings();
  return {
    usdt_floor: stored.usdt_floor ? parseFloat(stored.usdt_floor) : DEFAULTS.usdt_floor,
    leverage: stored.leverage ? parseInt(stored.leverage, 10) : DEFAULTS.leverage,
    risk_per_trade: stored.risk_per_trade
      ? parseFloat(stored.risk_per_trade)
      : DEFAULTS.risk_per_trade,
    bnb_buy_threshold: stored.bnb_buy_threshold
      ? parseFloat(stored.bnb_buy_threshold)
      : DEFAULTS.bnb_buy_threshold,
    hedge_ratio: stored.hedge_ratio
      ? parseFloat(stored.hedge_ratio)
      : DEFAULTS.hedge_ratio,
    webhook_enabled: stored.webhook_enabled
      ? stored.webhook_enabled === 'true'
      : DEFAULTS.webhook_enabled,
  };
}

export function updateSetting(key: keyof Settings, value: number | boolean): void {
  setSetting(key, String(value));
}

export function getEnvConfig() {
  return {
    binanceApiKey: process.env.BINANCE_API_KEY ?? '',
    binanceApiSecret: process.env.BINANCE_API_SECRET ?? '',
    encryptionKey: process.env.ENCRYPTION_KEY ?? '',
    webhookSecret: process.env.WEBHOOK_SECRET ?? '',
    webhookPort: parseInt(process.env.WEBHOOK_PORT ?? '3000', 10),
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    telegramChatId: process.env.TELEGRAM_CHAT_ID ?? '',
    llmApiKey: process.env.LLM_API_KEY ?? '',
    llmBaseUrl: process.env.LLM_BASE_URL ?? 'https://api.openai.com',
    llmModel: process.env.LLM_MODEL ?? 'gpt-4o-mini',
  };
}
