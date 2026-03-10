import type { BinanceClient } from '../api/binance-client.js';
import { getSettings } from '../config/settings.js';
import { createLogger } from '../utils/logger.js';
import type { TradeDirection } from '../api/types.js';

const log = createLogger('strategy');

interface Signal {
  direction: TradeDirection;
  source: string;
  reason: string;
}

/**
 * Built-in strategy: funding rate + RSI fallback.
 * Only used when TradingView webhooks are not configured.
 */
export class Strategy {
  private client: BinanceClient;

  constructor(client: BinanceClient) {
    this.client = client;
  }

  async evaluate(): Promise<Signal | null> {
    const fundingSignal = await this.checkFundingRate();
    if (fundingSignal) return fundingSignal;

    // RSI and other indicators would go here as fallback
    return null;
  }

  // ── Funding Rate Strategy ──────────────────────────────
  // Positive funding = longs pay shorts → short is profitable
  // Negative funding = shorts pay longs → long is profitable

  private async checkFundingRate(): Promise<Signal | null> {
    try {
      const funding = await this.client.getFundingRate();
      const rate = parseFloat(funding.fundingRate);

      // Strong positive funding → short (collect funding)
      if (rate > 0.0005) {
        return {
          direction: 'SHORT',
          source: 'FUNDING_RATE',
          reason: `High positive funding rate: ${(rate * 100).toFixed(4)}% → shorting to collect`,
        };
      }

      // Strong negative funding → long (collect funding)
      if (rate < -0.0005) {
        return {
          direction: 'LONG',
          source: 'FUNDING_RATE',
          reason: `Negative funding rate: ${(rate * 100).toFixed(4)}% → longing to collect`,
        };
      }

      return null; // neutral — no signal
    } catch (err) {
      log.error('Failed to evaluate funding rate', err);
      return null;
    }
  }
}
