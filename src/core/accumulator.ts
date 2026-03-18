import type { BinanceClient } from '../api/binance-client.js';
import { insertReward, isRewardProcessed } from '../db/queries.js';
import { createLogger } from '../utils/logger.js';
import { classifySource, sellToUsdt } from '../utils/reward-helpers.js';

const log = createLogger('accumulator');

/**
 * Accumulator handles the conversion of reward tokens to USDT.
 * Used by earn-manager as a shared utility for selling rewards.
 * Also provides manual "convert my airdrops" functionality.
 */
export class Accumulator {
  private client: BinanceClient;
  private notify: (msg: string) => void;

  constructor(client: BinanceClient, notify: (msg: string) => void) {
    this.client = client;
    this.notify = notify;
  }

  /**
   * Scan for unconverted rewards and sell them to USDT.
   */
  async convertPendingRewards(): Promise<{ converted: number; totalUsdt: number }> {
    const dividends = await this.client.getAssetDividend({ limit: 50 });
    let converted = 0;
    let totalUsdt = 0;

    for (const div of dividends) {
      if (div.asset === 'BNB') continue;
      if (isRewardProcessed(div.tranId)) continue;

      const amount = parseFloat(div.amount);

      try {
        const usdtAmount = await sellToUsdt(this.client, div.asset, amount);

        const source = classifySource(div.enInfo);
        insertReward({
          timestamp: new Date(div.divTime).toISOString(),
          source,
          asset: div.asset,
          amount,
          tran_id: div.tranId,
          converted_to: usdtAmount > 0 ? 'USDT' : null,
          converted_amount: usdtAmount > 0 ? usdtAmount : null,
        });

        if (usdtAmount > 0) {
          converted++;
          totalUsdt += usdtAmount;
        }
      } catch (err) {
        log.error(`Failed to convert ${div.asset}`, err);
      }
    }

    return { converted, totalUsdt };
  }
}
