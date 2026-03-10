import type { TradeEngine } from '../core/trade-engine.js';
import type { RiskManager } from '../core/risk-manager.js';
import { getTradeHistory } from '../db/queries.js';
import { formatPnl, formatTimestamp } from '../utils/formatter.js';

/**
 * OpenClaw skill: Manual trading
 * "Go short BNB", "Go long", "Close my position"
 */
export async function openTradeSkill(deps: {
  tradeEngine: TradeEngine;
  riskManager: RiskManager;
  direction: 'LONG' | 'SHORT';
}): Promise<string> {
  const { tradeEngine, riskManager, direction } = deps;

  const mode = await riskManager.getMode();
  if (mode === 'PASSIVE') {
    return '🔴 Trading is paused — USDT below floor. Earn-only mode.';
  }

  const size = await riskManager.calculateSize();
  if (size <= 0) {
    return '⚠️ Position size too small to trade.';
  }

  const tradeId = await tradeEngine.openTrade(direction, size);
  return `🦞 Opened ${direction} ${size.toFixed(2)} BNB (Trade #${tradeId})`;
}

export async function closeTradeSkill(deps: {
  tradeEngine: TradeEngine;
  tradeId?: number;
}): Promise<string> {
  const { tradeEngine, tradeId } = deps;

  if (tradeId) {
    await tradeEngine.closeTradeById(tradeId);
    return `🦞 Closed trade #${tradeId}`;
  }

  // Close all
  const open = tradeEngine.getOpenPositions();
  if (open.length === 0) {
    return '🦞 No open trades to close.';
  }

  await tradeEngine.closeAllTrades();
  return `🦞 Closed ${open.length} trade(s).`;
}

export function tradeHistorySkill(): string {
  const trades = getTradeHistory(10);

  if (trades.length === 0) {
    return '📊 No trade history yet.';
  }

  let msg = '📊 Recent Trades:\n';
  for (const t of trades) {
    const pnl = t.pnl_usdt != null ? formatPnl(t.pnl_usdt) : 'open';
    const action = t.pnl_action ? ` → ${t.pnl_action}` : '';
    msg += `  #${t.id} ${t.direction} ${t.size_bnb} BNB | ${t.status} | ${pnl}${action}\n`;
    msg += `     ${formatTimestamp(t.timestamp)} @ $${t.entry_price.toFixed(2)}`;
    if (t.exit_price) msg += ` → $${t.exit_price.toFixed(2)}`;
    msg += `\n`;
  }

  return msg;
}
