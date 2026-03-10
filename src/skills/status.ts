import type { BinanceClient } from '../api/binance-client.js';
import type { HedgeManager } from '../core/hedge-manager.js';
import { getTradeStats, getLatestBnbSnapshot, getBnbGrowth } from '../db/queries.js';
import { getSettings } from '../config/settings.js';
import { formatBnb, formatUsdt, formatPnl } from '../utils/formatter.js';
import type { RiskManager } from '../core/risk-manager.js';
import type { TradeEngine } from '../core/trade-engine.js';

/**
 * OpenClaw skill: "How's my BNB?" — portfolio overview
 */
export async function statusSkill(deps: {
  client: BinanceClient;
  riskManager: RiskManager;
  hedgeManager: HedgeManager;
  tradeEngine: TradeEngine;
}): Promise<string> {
  const { client, riskManager, hedgeManager, tradeEngine } = deps;

  // Gather data in parallel
  const [bnbSpot, usdtSpot, earnPositions, riskStatus, hedgeStatus, tradeStats, bnbGrowth, bufferInfo] =
    await Promise.all([
      client.getSpotBalance('BNB'),
      client.getSpotBalance('USDT'),
      client.getEarnPositions(),
      riskManager.getStatus(),
      hedgeManager.getStatus(),
      getTradeStats(30),
      getBnbGrowth(7),
      Promise.resolve(tradeEngine.getBuffer()),
    ]);

  const earnFree = earnPositions.reduce((sum, p) => sum + parseFloat(p.totalAmount || p.amount || '0'), 0);
  const earnCollateral = earnPositions.reduce((sum, p) => sum + parseFloat(p.collateralAmount || '0'), 0);
  const earnBnb = earnFree + earnCollateral;
  const totalBnb = bnbSpot.free + bnbSpot.locked + earnBnb;

  const modeEmoji = {
    ACTIVE: '🟢',
    CONSERVATIVE: '🟡',
    PASSIVE: '🔴',
  }[riskStatus.mode];

  let msg = `🦞 BNBClaw Status\n━━━━━━━━━━━━━━━━━━━━\n`;

  msg += `BNB Holdings:\n`;
  msg += `  Simple Earn:     ${formatBnb(earnBnb)} (auto: Launchpool + Airdrops + APY)\n`;
  if (earnCollateral > 0) {
    msg += `    Free:          ${formatBnb(earnFree)}\n`;
    msg += `    Collateral:    ${formatBnb(earnCollateral)}\n`;
  }
  msg += `  Spot:            ${formatBnb(bnbSpot.free)}\n`;
  msg += `  Total:           ${formatBnb(totalBnb)}`;
  if (bnbGrowth !== 0) msg += ` (${bnbGrowth >= 0 ? '+' : ''}${bnbGrowth.toFixed(4)} this week)`;
  msg += `\n\n`;

  msg += `USDT:\n`;
  msg += `  Spot Wallet:     ${formatUsdt(usdtSpot.free)}\n`;
  msg += `  Futures Wallet:  ${formatUsdt(riskStatus.usdtBalance)}\n`;
  msg += `  Floor:           ${formatUsdt(riskStatus.usdtFloor)}\n`;
  msg += `  Available:       ${formatUsdt(riskStatus.available)}\n`;
  msg += `  Mode:            ${modeEmoji} ${riskStatus.mode}\n\n`;

  if (hedgeStatus.active) {
    msg += `Hedge:\n`;
    msg += `  Status:          ON (${(hedgeStatus.hedgeRatio * 100).toFixed(0)}% hedged)\n`;
    msg += `  Short Size:      ${formatBnb(hedgeStatus.shortSize)}\n`;
    msg += `  Unrealized PnL:  ${formatPnl(hedgeStatus.unrealizedPnl)}\n\n`;
  } else {
    msg += `Hedge: OFF\n\n`;
  }

  msg += `30-Day Trading:\n`;
  msg += `  PnL:             ${formatPnl(tradeStats.totalPnl)}\n`;
  msg += `  Wins/Losses:     ${tradeStats.winCount}/${tradeStats.lossCount}\n`;
  msg += `  BNB Accumulated: ${formatBnb(tradeStats.bnbBought)}\n`;

  if (bufferInfo.buffer > 0) {
    msg += `\nShort Profit Buffer: ${formatUsdt(bufferInfo.buffer)} / ${formatUsdt(bufferInfo.threshold)}`;
  }

  return msg;
}
