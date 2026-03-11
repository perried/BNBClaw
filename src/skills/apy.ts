import type { BinanceClient } from '../api/binance-client.js';

/**
 * APY monitoring skill — shows top flexible/locked rates, optionally filtered by asset.
 * Uses tier rates when available (includes BNB holder bonuses).
 */

function bestTierRate(tierRates: Record<string, string>, fallback: string): number {
  const values = Object.values(tierRates).map(v => parseFloat(v)).filter(v => v > 0);
  return values.length > 0 ? Math.max(...values) : parseFloat(fallback);
}

export async function apySkill(
  client: BinanceClient,
  asset?: string
): Promise<string> {
  const [flexible, locked] = await Promise.all([
    client.getFlexibleProducts(asset),
    client.getLockedProducts(asset),
  ]);

  let msg = '🦞 Simple Earn APR Rates\n━━━━━━━━━━━━━━━━━━━━\n';

  // Flexible — use best tier rate (includes BNB holder bonus)
  const flexSorted = flexible
    .filter(p => p.canPurchase)
    .map(p => ({
      ...p,
      bestRate: bestTierRate(p.tierAnnualPercentageRate, p.latestAnnualPercentageRate),
    }))
    .filter(p => p.bestRate > 0)
    .sort((a, b) => b.bestRate - a.bestRate);

  const flexShow = asset ? flexSorted : flexSorted.slice(0, 10);
  if (flexShow.length > 0) {
    msg += '\n📈 Flexible (redeem anytime):\n';
    for (const p of flexShow) {
      const apr = (p.bestRate * 100).toFixed(2);
      msg += `  ${p.asset}: ${apr}% APR (min ${p.minPurchaseAmount})\n`;
    }
  }

  // Locked — top 10 by APR
  const lockedSorted = locked
    .filter(p => p.canPurchase && parseFloat(p.annualPercentageRate) > 0)
    .sort((a, b) => parseFloat(b.annualPercentageRate) - parseFloat(a.annualPercentageRate));

  const lockedShow = asset ? lockedSorted : lockedSorted.slice(0, 10);
  if (lockedShow.length > 0) {
    msg += '\n🔒 Locked:\n';
    for (const p of lockedShow) {
      const apr = (parseFloat(p.annualPercentageRate) * 100).toFixed(2);
      msg += `  ${p.asset}: ${apr}% APR — ${p.duration}d lock (min ${p.minPurchaseAmount})\n`;
    }
  }

  if (flexShow.length === 0 && lockedShow.length === 0) {
    msg += asset ? `No products found for ${asset}.` : 'No products available.';
  }

  return msg;
}
