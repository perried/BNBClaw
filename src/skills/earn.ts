import type { BinanceClient } from '../api/binance-client.js';
import type { EarnManager } from '../core/earn-manager.js';
import type { EventScheduler } from '../core/event-scheduler.js';
import { getRewardHistory, getRewardStats } from '../db/queries.js';
import { formatUsdt, formatTimestamp } from '../utils/formatter.js';

/**
 * OpenClaw skill: Earn management
 * "Move BNB to Simple Earn", "How much am I earning?", "Schedule Megadrop"
 */
export async function earnStatusSkill(deps: {
  client: BinanceClient;
}): Promise<string> {
  const { client } = deps;

  const earnPositions = await client.getEarnPositions();
  const earnFree = earnPositions.reduce((sum, p) => sum + parseFloat(p.totalAmount || p.amount || '0'), 0);
  const earnCollateral = earnPositions.reduce((sum, p) => sum + parseFloat(p.collateralAmount || '0'), 0);
  const earnBnb = earnFree + earnCollateral;

  const rewardStats = getRewardStats(30);
  const recentRewards = getRewardHistory(5);

  let msg = `🦞 Earn Status\n━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Simple Earn:     ${earnBnb.toFixed(4)} BNB (Flexible)\n`;
  if (earnCollateral > 0) {
    msg += `  Free:          ${earnFree.toFixed(4)} BNB\n`;
    msg += `  Collateral:    ${earnCollateral.toFixed(4)} BNB\n`;
  }
  msg += `Auto-enrolled:   Launchpool + HODLer Airdrops + APY\n\n`;

  msg += `Rewards (30 days):\n`;
  msg += `  Total converted: ${formatUsdt(rewardStats.totalUsdt)}\n`;
  msg += `  Distributions:   ${rewardStats.count}\n`;

  for (const [source, amount] of Object.entries(rewardStats.bySource)) {
    msg += `  ${source}: ${formatUsdt(amount)}\n`;
  }

  if (recentRewards.length > 0) {
    msg += `\nRecent:\n`;
    for (const r of recentRewards) {
      const converted = r.converted_amount ? ` → ${formatUsdt(r.converted_amount)}` : '';
      msg += `  ${formatTimestamp(r.timestamp)} | ${r.amount} ${r.asset} (${r.source})${converted}\n`;
    }
  }

  return msg;
}

export async function moveBnbToEarnSkill(deps: {
  client: BinanceClient;
  earnManager: EarnManager;
}): Promise<string> {
  const { client, earnManager } = deps;
  const { free } = await client.getSpotBalance('BNB');

  if (free < 0.01) {
    return '🦞 No idle BNB to move. All BNB is already in Simple Earn.';
  }

  await client.subscribeEarn('BNB', free);
  return (
    `✅ Moved ${free.toFixed(4)} BNB to Simple Earn Flexible.\n` +
    `Your BNB now earns APY + auto-qualifies for Launchpool + HODLer Airdrops.`
  );
}

export async function scheduleEventSkill(deps: {
  scheduler: EventScheduler;
  eventName: string;
  action: string;
  executeAt: Date;
  payload?: Record<string, unknown>;
}): Promise<string> {
  const { scheduler, eventName, action, executeAt, payload } = deps;

  const id = scheduler.schedule(eventName, action, executeAt, payload);

  return (
    `🦞 Scheduled: ${eventName}\n` +
    `Action: ${action}\n` +
    `At: ${executeAt.toISOString()}\n` +
    `Job ID: ${id}`
  );
}

export function showScheduleSkill(deps: { scheduler: EventScheduler }): string {
  const jobs = deps.scheduler.getSchedule();

  if (jobs.length === 0) {
    return '📅 No scheduled jobs.';
  }

  let msg = '📅 Scheduled Jobs:\n';
  for (let i = 0; i < jobs.length; i++) {
    msg += `  ${i + 1}. ${jobs[i].event_name}\n`;
    msg += `     Action: ${jobs[i].action}\n`;
    msg += `     At: ${formatTimestamp(jobs[i].execute_at)}  ⏳ ${jobs[i].status.toLowerCase()}\n`;
  }

  return msg;
}
