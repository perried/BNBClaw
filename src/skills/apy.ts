import type { BinanceClient } from '../api/binance-client.js';

export type EarnProductType = 'all' | 'flexible' | 'locked';

function bestTierRate(tierRates: Record<string, string>, fallback: string): number {
  const values = Object.values(tierRates).map((value) => parseFloat(value)).filter((value) => value > 0);
  return values.length > 0 ? Math.max(...values) : parseFloat(fallback);
}

export async function apySkill(
  client: BinanceClient,
  asset?: string,
  productType: EarnProductType = 'all',
): Promise<string> {
  const includeFlexible = productType === 'all' || productType === 'flexible';
  const includeLocked = productType === 'all' || productType === 'locked';

  const [flexible, locked] = await Promise.all([
    includeFlexible ? client.getFlexibleProducts(asset) : Promise.resolve([]),
    includeLocked ? client.getLockedProducts(asset) : Promise.resolve([]),
  ]);

  let msg = 'Simple Earn APR Rates\n--------------------\n';

  const flexSorted = flexible
    .filter((product) => product.canPurchase)
    .map((product) => ({
      ...product,
      bestRate: bestTierRate(product.tierAnnualPercentageRate ?? {}, product.latestAnnualPercentageRate),
    }))
    .filter((product) => product.bestRate > 0)
    .sort((left, right) => right.bestRate - left.bestRate);

  const flexShow = asset ? flexSorted : flexSorted.slice(0, 10);
  if (includeFlexible && flexShow.length > 0) {
    msg += '\nFlexible:\n';
    for (const product of flexShow) {
      const apr = (product.bestRate * 100).toFixed(2);
      msg += `  ${product.asset}: ${apr}% APR (min ${product.minPurchaseAmount})\n`;
    }
  }

  const lockedSorted = locked
    .filter((product) => product.canPurchase && parseFloat(product.annualPercentageRate) > 0)
    .sort((left, right) => parseFloat(right.annualPercentageRate) - parseFloat(left.annualPercentageRate));

  const lockedShow = asset ? lockedSorted : lockedSorted.slice(0, 10);
  if (includeLocked && lockedShow.length > 0) {
    msg += '\nLocked:\n';
    for (const product of lockedShow) {
      const apr = (parseFloat(product.annualPercentageRate) * 100).toFixed(2);
      const extras = [
        product.extraRewardAPR ? `extra ${(parseFloat(product.extraRewardAPR) * 100).toFixed(2)}%` : '',
        product.boostApr ? `boost ${(parseFloat(product.boostApr) * 100).toFixed(2)}%` : '',
      ].filter(Boolean).join(', ');
      msg += `  ${product.asset}: ${apr}% APR - ${product.duration}d lock (min ${product.minPurchaseAmount})`;
      if (extras) msg += ` [${extras}]`;
      msg += '\n';
    }
  }

  if (flexShow.length === 0 && lockedShow.length === 0) {
    const typeLabel = productType === 'all' ? 'Simple Earn products' : `${productType} products`;
    msg += asset ? `No ${typeLabel} found for ${asset}.` : `No ${typeLabel} available.`;
  }

  return msg;
}
