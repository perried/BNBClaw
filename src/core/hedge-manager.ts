import type { BinanceClient } from '../api/binance-client.js';
import { getSettings } from '../config/settings.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('hedge-manager');

export class HedgeManager {
  private client: BinanceClient;
  private notify: (msg: string) => void;
  private active = false;

  constructor(client: BinanceClient, notify: (msg: string) => void) {
    this.client = client;
    this.notify = notify;
  }

  // ── Activate Hedge ─────────────────────────────────────

  async activate(): Promise<void> {
    if (this.active) {
      this.notify('🦞 Hedge is already active.');
      return;
    }

    const settings = getSettings();
    const bnbTotal = await this.getBnbTotal();
    const targetShort = bnbTotal * settings.hedge_ratio;

    await this.client.placeFuturesOrder('SELL', targetShort, settings.leverage);

    this.active = true;
    log.info(`Hedge activated: short ${targetShort.toFixed(2)} BNB (${settings.hedge_ratio * 100}%)`);
    this.notify(
      `🦞 Hedge activated!\n` +
      `Shorted ${targetShort.toFixed(2)} BNB (${(settings.hedge_ratio * 100).toFixed(0)}% of holdings)\n` +
      `Your BNB value is now delta-neutral.`
    );
  }

  // ── Deactivate Hedge ───────────────────────────────────

  async deactivate(): Promise<void> {
    if (!this.active) {
      this.notify('🦞 Hedge is not active.');
      return;
    }

    const positions = await this.client.getFuturesPositions();
    const bnbShort = positions.find(
      (p) => p.symbol === 'BNBUSDT' && parseFloat(p.positionAmt) < 0
    );

    if (bnbShort) {
      const size = Math.abs(parseFloat(bnbShort.positionAmt));
      await this.client.placeFuturesOrder('BUY', size);
      log.info(`Hedge closed: bought back ${size} BNB`);
    }

    this.active = false;
    this.notify('🦞 Hedge deactivated. Position closed.');
  }

  // ── Rebalance ──────────────────────────────────────────

  async rebalance(): Promise<void> {
    if (!this.active) return;

    const settings = getSettings();
    const bnbTotal = await this.getBnbTotal();
    const targetShort = bnbTotal * settings.hedge_ratio;

    const positions = await this.client.getFuturesPositions();
    const bnbShort = positions.find(
      (p) => p.symbol === 'BNBUSDT' && parseFloat(p.positionAmt) < 0
    );

    const currentShort = bnbShort ? Math.abs(parseFloat(bnbShort.positionAmt)) : 0;
    const diff = targetShort - currentShort;

    // Only rebalance if drift > 5%
    if (Math.abs(diff) / targetShort < 0.05) return;

    if (diff > 0) {
      // Need more short
      await this.client.placeFuturesOrder('SELL', Math.abs(diff));
      log.info(`Hedge rebalance: added ${Math.abs(diff).toFixed(2)} short`);
    } else {
      // Over-hedged, reduce
      await this.client.placeFuturesOrder('BUY', Math.abs(diff));
      log.info(`Hedge rebalance: reduced ${Math.abs(diff).toFixed(2)} short`);
    }
  }

  // ── Status ─────────────────────────────────────────────

  async getStatus(): Promise<{
    active: boolean;
    bnbTotal: number;
    shortSize: number;
    hedgeRatio: number;
    fundingIncome24h: number;
    unrealizedPnl: number;
  }> {
    const bnbTotal = await this.getBnbTotal();
    const positions = await this.client.getFuturesPositions();
    const bnbShort = positions.find(
      (p) => p.symbol === 'BNBUSDT' && parseFloat(p.positionAmt) < 0
    );

    const shortSize = bnbShort ? Math.abs(parseFloat(bnbShort.positionAmt)) : 0;
    const unrealizedPnl = bnbShort ? parseFloat(bnbShort.unRealizedProfit) : 0;

    return {
      active: this.active,
      bnbTotal,
      shortSize,
      hedgeRatio: bnbTotal > 0 ? shortSize / bnbTotal : 0,
      fundingIncome24h: 0, // TODO: calculate from funding rate payments
      unrealizedPnl,
    };
  }

  isActive(): boolean {
    return this.active;
  }

  // ── Helpers ────────────────────────────────────────────

  private async getBnbTotal(): Promise<number> {
    const { free, locked } = await this.client.getSpotBalance('BNB');
    const earnPositions = await this.client.getEarnPositions();
    const earnBnb = earnPositions.reduce((sum, p) => {
      return sum + parseFloat(p.totalAmount || p.amount || '0') + parseFloat(p.collateralAmount || '0');
    }, 0);
    return free + locked + earnBnb;
  }
}
