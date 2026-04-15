import type { BinanceClient } from '../api/binance-client.js';
import type { EarnManager } from '../core/earn-manager.js';
import type { EventScheduler } from '../core/event-scheduler.js';
import { getRewardHistory, getRewardStats } from '../db/queries.js';
import { formatUsdt, formatTimestamp } from '../utils/formatter.js';

function bestFlexibleRate(position: {
  latestAnnualPercentageRate?: string;
  tierAnnualPercentageRate?: Record<string, string>;
}): number {
  const tierRates = Object.values(position.tierAnnualPercentageRate ?? {})
    .map((value) => parseFloat(value))
    .filter((value) => value > 0);
  if (tierRates.length > 0) return Math.max(...tierRates);
  return parseFloat(position.latestAnnualPercentageRate ?? '0');
}

function formatAmount(amount: string): string {
  return parseFloat(amount).toFixed(4);
}

export async function earnStatusSkill(deps: {
  client: BinanceClient;
}): Promise<string> {
  const { client } = deps;

  const [account, flexiblePositions, lockedPositions] = await Promise.all([
    client.getSimpleEarnAccount(),
    client.getEarnPositions(),
    client.getLockedPositions(),
  ]);

  const rewardStats = getRewardStats(30);
  const recentRewards = getRewardHistory(5);

  let msg = 'Simple Earn\n--------------------\n';
  msg += `Total:      ${formatUsdt(parseFloat(account.totalAmountInUSDT || '0'))}\n`;
  msg += `Flexible:   ${formatUsdt(parseFloat(account.totalFlexibleAmountInUSDT || '0'))}\n`;
  msg += `Locked:     ${formatUsdt(parseFloat(account.totalLockedInUSDT || '0'))}\n`;

  if (flexiblePositions.length > 0) {
    msg += '\nFlexible Positions:\n';
    for (const position of flexiblePositions.slice(0, 8)) {
      const apr = (bestFlexibleRate(position) * 100).toFixed(2);
      msg += `  ${position.asset}: ${formatAmount(position.totalAmount || position.amount)} @ ${apr}%\n`;
    }
  }

  if (lockedPositions.length > 0) {
    msg += '\nLocked Positions:\n';
    for (const position of lockedPositions.slice(0, 8)) {
      const apr = (parseFloat(position.APY || '0') * 100).toFixed(2);
      msg += `  ${position.asset}: ${formatAmount(position.amount)} for ${position.duration}d @ ${apr}%\n`;
    }
  }

  msg += '\nReward Conversions (30d):\n';
  msg += `  Converted: ${formatUsdt(rewardStats.totalUsdt)}\n`;
  msg += `  Records:   ${rewardStats.count}\n`;

  if (recentRewards.length > 0) {
    msg += '\nRecent Rewards:\n';
    for (const reward of recentRewards) {
      const converted = reward.converted_amount ? ` -> ${formatUsdt(reward.converted_amount)}` : '';
      msg += `  ${formatTimestamp(reward.timestamp)} | ${reward.amount} ${reward.asset} (${reward.source})${converted}\n`;
    }
  }

  return msg;
}

export async function moveBnbToEarnSkill(deps: {
  client: BinanceClient;
}): Promise<string> {
  const { client } = deps;
  const { free } = await client.getSpotBalance('BNB');

  if (free < 0.01) {
    return 'No idle BNB to move. All BNB is already in Simple Earn.';
  }

  await client.subscribeEarn('BNB', free, { sourceAccount: 'SPOT' });
  return (
    `Moved ${free.toFixed(4)} BNB to Simple Earn Flexible.\n` +
    'Your BNB now earns APY and qualifies for Launchpool and HODLer airdrops.'
  );
}

export async function convertDustToBnbSkill(deps: {
  earnManager: EarnManager;
}): Promise<string> {
  const summary = await deps.earnManager.cleanupDust({ notify: false });
  if (summary.assets.length === 0 || summary.convertedBnb <= 0) {
    return 'No dust balances were eligible for conversion to BNB.';
  }

  const assetList = summary.assets.join(', ');
  return (
    `Converted dust to BNB from: ${assetList}\n` +
    `Received ${summary.convertedBnb.toFixed(8)} BNB` +
    (summary.feeBnb > 0 ? ` after ${summary.feeBnb.toFixed(8)} BNB in fees.` : '.')
  );
}

export async function convertRewardDistributionsSkill(deps: {
  earnManager: EarnManager;
  days?: number;
}): Promise<string> {
  const days = deps.days ?? 30;
  const startTime = Date.now() - days * 86400000;
  const summary = await deps.earnManager.syncRecentRewards({
    startTime,
    limit: 100,
    notify: false,
  });

  if (summary.convertedCount === 0 && summary.pendingCount === 0 && summary.newlyRecorded === 0) {
    return `No new Launchpool or HODLer rewards needed processing in the last ${days} days.`;
  }

  return (
    `Reward sync (${days}d)\n` +
    `Scanned: ${summary.scanned}\n` +
    `Converted: ${summary.convertedCount} -> ${formatUsdt(summary.convertedUsdt)}\n` +
    `Pending retry: ${summary.pendingCount}\n` +
    `New records: ${summary.newlyRecorded}`
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
    `Scheduled: ${eventName}\n` +
    `Action: ${action}\n` +
    `At: ${executeAt.toISOString()}\n` +
    `Job ID: ${id}`
  );
}

export function showScheduleSkill(deps: { scheduler: EventScheduler }): string {
  const jobs = deps.scheduler.getSchedule();

  if (jobs.length === 0) {
    return 'No scheduled jobs.';
  }

  let msg = 'Scheduled Jobs:\n';
  for (let i = 0; i < jobs.length; i++) {
    msg += `  ${i + 1}. ${jobs[i].event_name}\n`;
    msg += `     Action: ${jobs[i].action}\n`;
    msg += `     At: ${formatTimestamp(jobs[i].execute_at)} | ${jobs[i].status.toLowerCase()}\n`;
  }

  return msg;
}
