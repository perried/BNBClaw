import { getSettings, updateSetting, validateSetting } from '../config/settings.js';
import { formatUsdt } from '../utils/formatter.js';
import type { Settings } from '../api/types.js';

/**
 * OpenClaw skill: Configuration
 * "Set USDT floor to 500", "Show my settings"
 */
export function showSettingsSkill(): string {
  const s = getSettings();

  return (
    `🦞 Settings\n━━━━━━━━━━━━━━━━━━━━\n` +
    `USDT Floor:        ${formatUsdt(s.usdt_floor)}\n` +
    `Leverage:          ${s.leverage}x\n` +
    `Risk per Trade:    ${(s.risk_per_trade * 100).toFixed(1)}%\n` +
    `BNB Buy Threshold: ${formatUsdt(s.bnb_buy_threshold)}\n` +
    `Hedge Ratio:       ${(s.hedge_ratio * 100).toFixed(0)}%\n` +
    `Webhook:           ${s.webhook_enabled ? 'ON' : 'OFF'}`
  );
}

export function updateSettingSkill(key: keyof Settings, value: number | boolean): string {
  const validKeys: (keyof Settings)[] = [
    'usdt_floor',
    'leverage',
    'risk_per_trade',
    'bnb_buy_threshold',
    'hedge_ratio',
    'webhook_enabled',
  ];

  if (!validKeys.includes(key)) {
    return `⚠️ Unknown setting: ${key}\nValid: ${validKeys.join(', ')}`;
  }

  const validationError = validateSetting(key, value);
  if (validationError) {
    return `⚠️ ${validationError}`;
  }

  updateSetting(key, value);

  const display: Record<string, string> = {
    usdt_floor: `USDT Floor → ${formatUsdt(value as number)}`,
    leverage: `Leverage → ${value}x`,
    risk_per_trade: `Risk per Trade → ${((value as number) * 100).toFixed(1)}%`,
    bnb_buy_threshold: `BNB Buy Threshold → ${formatUsdt(value as number)}`,
    hedge_ratio: `Hedge Ratio → ${((value as number) * 100).toFixed(0)}%`,
    webhook_enabled: `Webhook → ${value ? 'ON' : 'OFF'}`,
  };

  return `✅ Updated: ${display[key]}`;
}
