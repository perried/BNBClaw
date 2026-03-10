import type { HedgeManager } from '../core/hedge-manager.js';
import { formatBnb, formatPnl } from '../utils/formatter.js';

/**
 * OpenClaw skill: Hedge control
 * "Activate hedge", "Deactivate hedge", "Hedge status"
 */
export async function activateHedgeSkill(deps: {
  hedgeManager: HedgeManager;
}): Promise<string> {
  await deps.hedgeManager.activate();
  const status = await deps.hedgeManager.getStatus();
  return (
    `🦞 Hedge activated!\n` +
    `Shorted ${formatBnb(status.shortSize)} (${(status.hedgeRatio * 100).toFixed(0)}% of ${formatBnb(status.bnbTotal)})\n` +
    `Your BNB value is now delta-neutral.`
  );
}

export async function deactivateHedgeSkill(deps: {
  hedgeManager: HedgeManager;
}): Promise<string> {
  await deps.hedgeManager.deactivate();
  return '🦞 Hedge deactivated. Short position closed.';
}

export async function hedgeStatusSkill(deps: {
  hedgeManager: HedgeManager;
}): Promise<string> {
  const status = await deps.hedgeManager.getStatus();

  if (!status.active) {
    return '🦞 Hedge: OFF\nUse "activate hedge" to protect your BNB from downside.';
  }

  return (
    `🦞 Hedge Status\n━━━━━━━━━━━━━━━━━━━━\n` +
    `Status:          ON\n` +
    `BNB Total:       ${formatBnb(status.bnbTotal)}\n` +
    `Short Size:      ${formatBnb(status.shortSize)}\n` +
    `Hedge Ratio:     ${(status.hedgeRatio * 100).toFixed(0)}%\n` +
    `Unrealized PnL:  ${formatPnl(status.unrealizedPnl)}`
  );
}
