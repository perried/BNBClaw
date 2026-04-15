import type { BinanceClient } from '../api/binance-client.js';
import { getRewardStats } from '../db/queries.js';
import { formatUsdt } from '../utils/formatter.js';

const HIGHLIGHT_TYPES = ['hodler airdrop', 'bnb vault', 'launchpool', 'staking', 'mining'];

function isHighlighted(enInfo: string): boolean {
  const lower = enInfo.toLowerCase();
  return HIGHLIGHT_TYPES.some((type) => lower.includes(type));
}

export async function rewardHistorySkill(client: BinanceClient, days = 30): Promise<string> {
  const startTime = Date.now() - days * 86400000;
  const dividends = await client.getAssetDividend({ startTime, limit: 100 });

  const byType: Record<string, Array<{ asset: string; amount: string; time: number }>> = {};
  for (const dividend of dividends) {
    const type = dividend.enInfo;
    if (!byType[type]) byType[type] = [];
    byType[type].push({ asset: dividend.asset, amount: dividend.amount, time: dividend.divTime });
  }

  let msg = `Distributions (${days} days) - ${dividends.length} total\n--------------------\n`;

  if (dividends.length === 0) {
    msg += 'No distributions found.\n';
  } else {
    const highlighted = Object.entries(byType).filter(([type]) => isHighlighted(type));
    const other = Object.entries(byType).filter(([type]) => !isHighlighted(type));

    for (const [type, items] of [...highlighted, ...other]) {
      const marker = isHighlighted(type) ? '*' : '-';
      msg += `\n${marker} ${type} (${items.length})\n`;
      for (const item of items.sort((left, right) => right.time - left.time)) {
        const date = new Date(item.time).toISOString().slice(0, 10);
        msg += `  ${date} | +${item.amount} ${item.asset}\n`;
      }
    }
  }

  const stats = getRewardStats(days);
  if (stats.count > 0) {
    msg += `\nConverted rewards: ${formatUsdt(stats.totalUsdt)} (${stats.count} records)\n`;
    for (const [source, amount] of Object.entries(stats.bySource)) {
      msg += `  ${source}: ${formatUsdt(amount)}\n`;
    }
  }

  return msg;
}
