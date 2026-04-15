import type { BinanceClient } from '../api/binance-client.js';
import { formatBnb, formatUsdt } from '../utils/formatter.js';

export async function statusSkill(deps: {
  client: BinanceClient;
}): Promise<string> {
  const { client } = deps;

  const [bnbSpot, usdtSpot, bnbEarnPositions, bnbLockedPositions] = await Promise.all([
    client.getSpotBalance('BNB'),
    client.getSpotBalance('USDT'),
    client.getEarnPositions('BNB'),
    client.getLockedPositions('BNB'),
  ]);

  const earnFree = bnbEarnPositions.reduce(
    (sum, position) => sum + parseFloat(position.totalAmount || position.amount || '0'),
    0,
  );
  const earnCollateral = bnbEarnPositions.reduce(
    (sum, position) => sum + parseFloat(position.collateralAmount || '0'),
    0,
  );
  const lockedBnb = bnbLockedPositions.reduce(
    (sum, position) => sum + parseFloat(position.amount || '0'),
    0,
  );
  const earnBnb = earnFree + earnCollateral + lockedBnb;
  const totalBnb = bnbSpot.free + bnbSpot.locked + earnBnb;

  let msg = 'BNBClaw Status\n--------------------\n';
  msg += 'BNB Holdings:\n';
  msg += `  Simple Earn: ${formatBnb(earnBnb)}\n`;
  if (earnCollateral > 0) {
    msg += `  Flexible:    ${formatBnb(earnFree)}\n`;
    msg += `  Collateral:  ${formatBnb(earnCollateral)}\n`;
  }
  if (lockedBnb > 0) {
    msg += `  Locked:      ${formatBnb(lockedBnb)}\n`;
  }
  msg += `  Spot:        ${formatBnb(bnbSpot.free + bnbSpot.locked)}\n`;
  msg += `  Total:       ${formatBnb(totalBnb)}\n\n`;
  msg += `USDT Spot:     ${formatUsdt(usdtSpot.free)}`;

  return msg;
}
