import type { Accumulator } from '../core/accumulator.js';
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

export function rewardHistorySkill(days = 30): string {
  const stats = getRewardStats(days);
  const recent = getRewardHistory(10);

  let msg = `🦞 Rewards (${days} days)\n━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Total USDT from rewards: ${formatUsdt(stats.totalUsdt)}\n`;
  msg += `Distributions: ${stats.count}\n\n`;

  for (const [source, amount] of Object.entries(stats.bySource)) {
    msg += `  ${source}: ${formatUsdt(amount)}\n`;
  }

  if (recent.length > 0) {
    msg += `\nRecent:\n`;
    for (const r of recent) {
      const converted = r.converted_amount ? ` → ${formatUsdt(r.converted_amount)}` : '';
      msg += `  ${formatTimestamp(r.timestamp)} | ${r.amount} ${r.asset} (${r.source})${converted}\n`;
    }
  }

  return msg;
}
