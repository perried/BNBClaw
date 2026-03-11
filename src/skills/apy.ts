import type { BinanceClient } from '../api/binance-client.js';

/**
 * APY monitoring skill — shows top flexible/locked rates, optionally filtered by asset.
 */
export async function apySkill(
  client: BinanceClient,
  asset?: string
): Promise<string> {
  const [flexible, locked] = await Promise.all([
    client.getFlexibleProducts(asset),
    client.getLockedProducts(asset),
  ]);

  let msg = '🦞 Simple Earn APY Rates\n━━━━━━━━━━━━━━━━━━━━\n';

  // Flexible — top 10 by APY (or all if filtered by asset)
  const flexSorted = flexible
    .filter(p => p.canPurchase && parseFloat(p.latestAnnualPercentageRate) > 0)
    .sort((a, b) => parseFloat(b.latestAnnualPercentageRate) - parseFloat(a.latestAnnualPercentageRate));

  const flexShow = asset ? flexSorted : flexSorted.slice(0, 10);
  if (flexShow.length > 0) {
    msg += '\n📈 Flexible (redeem anytime):\n';
    for (const p of flexShow) {
      const apy = (parseFloat(p.latestAnnualPercentageRate) * 100).toFixed(2);
      msg += `  ${p.asset}: ${apy}% APY (min ${p.minPurchaseAmount})\n`;
    }
  }

  // Locked — top 10 by APY
  const lockedSorted = locked
    .filter(p => p.canPurchase && parseFloat(p.annualPercentageRate) > 0)
    .sort((a, b) => parseFloat(b.annualPercentageRate) - parseFloat(a.annualPercentageRate));

  const lockedShow = asset ? lockedSorted : lockedSorted.slice(0, 10);
  if (lockedShow.length > 0) {
    msg += '\n🔒 Locked:\n';
    for (const p of lockedShow) {
      const apy = (parseFloat(p.annualPercentageRate) * 100).toFixed(2);
      msg += `  ${p.asset}: ${apy}% APY — ${p.duration}d lock (min ${p.minPurchaseAmount})\n`;
    }
  }

  if (flexShow.length === 0 && lockedShow.length === 0) {
    msg += asset ? `No products found for ${asset}.` : 'No products available.';
  }

  return msg;
}
