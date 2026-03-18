import type { BinanceClient } from '../api/binance-client.js';
import { getSettings } from '../config/settings.js';
import {
  insertTrade,
  closeTrade,
  getOpenTrades,
  getShortProfitBuffer,
  addToShortProfitBuffer,
  resetShortProfitBuffer,
} from '../db/queries.js';
import { createLogger } from '../utils/logger.js';
import type { TradeDirection } from '../api/types.js';

const log = createLogger('trade-engine');

export class TradeEngine {
  private client: BinanceClient;
  private notify: (msg: string) => void;

  constructor(client: BinanceClient, notify: (msg: string) => void) {
    this.client = client;
    this.notify = notify;
  }

  // ── Open Trade ─────────────────────────────────────────

  async openTrade(direction: TradeDirection, sizeBnb: number): Promise<number> {
    const settings = getSettings();
    const side = direction === 'LONG' ? 'BUY' : 'SELL';

    const order = await this.client.placeFuturesOrder(side, sizeBnb, settings.leverage);

    const tradeId = insertTrade({
      timestamp: new Date().toISOString(),
      direction,
      entry_price: parseFloat(order.avgPrice),
      exit_price: null,
      size_bnb: sizeBnb,
      pnl_usdt: null,
      pnl_action: null,
      status: 'OPEN',
    });

    log.info(`Opened ${direction} ${sizeBnb} BNB @ ${order.avgPrice}`, { tradeId });
    this.notify(`🦞 Opened ${direction} ${sizeBnb.toFixed(2)} BNB @ $${parseFloat(order.avgPrice).toFixed(2)}`);

    return tradeId;
  }

  // ── Close Trade ────────────────────────────────────────

  async closeTradeById(tradeId: number): Promise<void> {
    const openTrades = getOpenTrades();
    const trade = openTrades.find((t) => t.id === tradeId);
    if (!trade) throw new Error(`No open trade with id ${tradeId}`);

    // Opposite side to close
    const closeSide = trade.direction === 'LONG' ? 'SELL' : 'BUY';
    const order = await this.client.placeFuturesOrder(closeSide, trade.size_bnb);

    const exitPrice = parseFloat(order.avgPrice);
    const pnl =
      trade.direction === 'LONG'
        ? (exitPrice - trade.entry_price) * trade.size_bnb
        : (trade.entry_price - exitPrice) * trade.size_bnb;

    const action = await this.routeProfit(trade.direction, pnl);
    closeTrade(tradeId, exitPrice, pnl, action);

    log.info(`Closed trade #${tradeId}: PnL ${pnl.toFixed(2)} USDT → ${action}`);
    this.notify(
      `🦞 Closed ${trade.direction} #${tradeId} @ $${exitPrice.toFixed(2)}\n` +
      `PnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} → ${action}`
    );
  }

  async closeAllTrades(): Promise<void> {
    const openTrades = getOpenTrades();
    for (const trade of openTrades) {
      await this.closeTradeById(trade.id!);
    }
  }

  // ── Profit Routing ─────────────────────────────────────

  private async routeProfit(direction: TradeDirection, pnl: number): Promise<string> {
    if (pnl <= 0) return 'KEEP_USDT'; // loss — nothing to route

    if (direction === 'SHORT') {
      // Accumulate toward BNB purchase
      const buffer = addToShortProfitBuffer(pnl);
      const settings = getSettings();

      if (buffer >= settings.bnb_buy_threshold) {
        await this.buyBnbWithBuffer(buffer);
        return 'BUY_BNB';
      }

      this.notify(
        `💰 Short profit +$${pnl.toFixed(2)} added to buffer.\n` +
        `Buffer: $${buffer.toFixed(2)} / $${settings.bnb_buy_threshold} toward next BNB buy.`
      );
      return 'BUY_BNB'; // intent is BNB, just buffered
    }

    // LONG profit → keep as USDT
    return 'KEEP_USDT';
  }

  private async buyBnbWithBuffer(bufferUsdt: number): Promise<void> {
    try {
      // Transfer USDT from futures wallet to spot wallet first
      await this.client.universalTransfer('UMFUTURE_MAIN', 'USDT', bufferUsdt);

      const order = await this.client.placeSpotQuoteOrder('BUY', bufferUsdt, 'BNBUSDT');
      const bnbBought = parseFloat(order.executedQty);

      // Move to Simple Earn
      await this.client.subscribeEarn('BNB', bnbBought);

      resetShortProfitBuffer();

      log.info(`Buffer buy: $${bufferUsdt.toFixed(2)} → ${bnbBought} BNB → Simple Earn`);
      this.notify(
        `🦞 Accumulated $${bufferUsdt.toFixed(2)} in short profits → bought ${bnbBought.toFixed(4)} BNB → Simple Earn`
      );
    } catch (err) {
      log.error('Failed to buy BNB with buffer', err);
      this.notify(`⚠️ Failed to convert short profit buffer to BNB. Will retry.`);
    }
  }

  // ── Get Status ─────────────────────────────────────────

  getOpenPositions() {
    return getOpenTrades();
  }

  getBuffer(): { buffer: number; threshold: number } {
    const settings = getSettings();
    return {
      buffer: getShortProfitBuffer(),
      threshold: settings.bnb_buy_threshold,
    };
  }
}
