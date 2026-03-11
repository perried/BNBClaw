import type { Accumulator } from '../core/accumulator.js';
import type { BinanceClient } from '../api/binance-client.js';
import { getRewardHistory, getRewardStats } from '../db/queries.js';
import { formatUsdt, formatTimestamp } from '../utils/formatter.js';

/**
 * OpenClaw skill: Reward management
 * "Convert my airdrops", "What rewards did I get?"
 */
export async function convertRewardsSkill(deps: {
  accumulator: Accumulator;
}): Promise<string> {
  const result = await deps.accumulator.convertPendingRewards();

  if (result.converted === 0) {
    return '🦞 No pending rewards to convert.';
  }

  return (
    `🦞 Converted ${result.converted} reward(s) → ${formatUsdt(result.totalUsdt)} USDT`
  );
}

const TRACKED_TYPES = ['hodler airdrop', 'bnb vault', 'launchpool'];

function isTrackedDistribution(enInfo: string): boolean {
  const lower = enInfo.toLowerCase();
  return TRACKED_TYPES.some(t => lower.includes(t));
}

export async function rewardHistorySkill(client: BinanceClient, days = 30): Promise<string> {
  const startTime = Date.now() - days * 86400000;

  // Fetch live distributions from Binance
  const dividends = await client.getAssetDividend({ startTime, limit: 100 });
  const tracked = dividends.filter(d => isTrackedDistribution(d.enInfo));

  // Group by type
  const byType: Record<string, Array<{ asset: string; amount: string; time: number }>> = {};
  for (const d of tracked) {
    const type = d.enInfo;
    if (!byType[type]) byType[type] = [];
    byType[type].push({ asset: d.asset, amount: d.amount, time: d.divTime });
  }

  let msg = `🦞 Distributions (${days} days)\n━━━━━━━━━━━━━━━━━━━━\n`;

  if (tracked.length === 0) {
    msg += 'No HODLer Airdrops, BNB Vault, or Launchpool distributions found.\n';
  } else {
    for (const [type, items] of Object.entries(byType)) {
      msg += `\n📌 ${type} (${items.length})\n`;
      for (const item of items.sort((a, b) => b.time - a.time)) {
        const date = new Date(item.time).toISOString().slice(0, 10);
        msg += `  ${date} | +${item.amount} ${item.asset}\n`;
      }
    }
  }

  // Also show local DB stats for converted rewards
  const stats = getRewardStats(days);
  if (stats.count > 0) {
    msg += `\n💰 Converted rewards: ${formatUsdt(stats.totalUsdt)} USDT (${stats.count} total)\n`;
    for (const [source, amount] of Object.entries(stats.bySource)) {
      msg += `  ${source}: ${formatUsdt(amount)}\n`;
    }
  }

  return msg;
}
