import type { BinanceClient } from '../api/binance-client.js';
import { getSettings } from '../config/settings.js';
import { createLogger } from '../utils/logger.js';
import type { TradingMode } from '../api/types.js';

const log = createLogger('risk-manager');

export class RiskManager {
  private client: BinanceClient;
  private notify: (msg: string) => void;

  constructor(client: BinanceClient, notify: (msg: string) => void) {
    this.client = client;
    this.notify = notify;
  }

  // ── Trading Mode ───────────────────────────────────────

  async getMode(): Promise<TradingMode> {
    const settings = getSettings();
    const { balance } = await this.client.getFuturesBalance();

    if (balance <= settings.usdt_floor) return 'PASSIVE';
    if (balance > settings.usdt_floor * 2.0) return 'ACTIVE';
    return 'CONSERVATIVE';
  }

  // ── Position Sizing ────────────────────────────────────

  async calculateSize(): Promise<number> {
    const settings = getSettings();
    const mode = await this.getMode();

    if (mode === 'PASSIVE') return 0;

    const { balance } = await this.client.getFuturesBalance();
    const available = balance - settings.usdt_floor;
    let riskAmount = available * settings.risk_per_trade;

    if (mode === 'CONSERVATIVE') {
      riskAmount *= 0.5;
    }

    // Convert USDT risk to BNB size
    const price = await this.client.getPrice();
    const sizeBnb = (riskAmount * settings.leverage) / price;

    // Min 0.01 BNB, round to 2 decimals
    return Math.max(0.01, Math.round(sizeBnb * 100) / 100);
  }

  // ── Margin Health Check ────────────────────────────────

  async checkMarginHealth(): Promise<void> {
    try {
      const marginRatio = await this.client.getFuturesMarginRatio();

      if (marginRatio > 80) {
        log.error(`DANGER: Margin ratio ${marginRatio.toFixed(1)}%`);
        this.notify(`⚠️ DANGER: Margin ratio ${marginRatio.toFixed(1)}%. Reducing position.`);
        // Trade engine should reduce position — emit event
      } else if (marginRatio > 60) {
        log.warn(`Warning: Margin ratio ${marginRatio.toFixed(1)}%`);
        this.notify(`⚡ Margin ratio ${marginRatio.toFixed(1)}%. Monitoring closely.`);
      }
    } catch (err) {
      log.error('Failed to check margin health', err);
    }
  }

  // ── USDT Floor Check ──────────────────────────────────

  async checkUsdtFloor(): Promise<boolean> {
    const settings = getSettings();
    const { balance } = await this.client.getFuturesBalance();
    const { free: spotUsdt } = await this.client.getSpotBalance('USDT');
    const total = balance + spotUsdt;

    if (total <= settings.usdt_floor) {
      log.warn(`USDT floor breached: $${total.toFixed(2)} <= $${settings.usdt_floor}`);
      return false; // below floor
    }
    return true; // above floor
  }

  // ── Status ─────────────────────────────────────────────

  async getStatus(): Promise<{
    mode: TradingMode;
    usdtBalance: number;
    usdtFloor: number;
    available: number;
    marginRatio: number;
    maxPositionSize: number;
  }> {
    const settings = getSettings();
    const mode = await this.getMode();
    const { balance } = await this.client.getFuturesBalance();
    const marginRatio = await this.client.getFuturesMarginRatio();
    const maxSize = await this.calculateSize();

    return {
      mode,
      usdtBalance: balance,
      usdtFloor: settings.usdt_floor,
      available: Math.max(0, balance - settings.usdt_floor),
      marginRatio,
      maxPositionSize: maxSize,
    };
  }
}
