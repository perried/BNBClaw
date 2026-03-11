import type { BinanceClient } from '../api/binance-client.js';
import { insertReward, isRewardProcessed } from '../db/queries.js';
import { createLogger } from '../utils/logger.js';
import type { RewardSource } from '../api/types.js';

const log = createLogger('earn-manager');

export class EarnManager {
  private client: BinanceClient;
  private notify: (msg: string) => void;

  constructor(client: BinanceClient, notify: (msg: string) => void) {
    this.client = client;
    this.notify = notify;
  }

  // ── WebSocket handler: instant reward detection ────────

  async onBalanceUpdate(asset: string, delta: number): Promise<void> {
    if (asset === 'BNB' || asset === 'USDT' || delta <= 0) return;

    log.info(`Balance update: +${delta} ${asset}, verifying if reward...`);

    // Cross-check with dividend API to confirm it's a reward
    const dividends = await this.client.getAssetDividend({ asset, limit: 5 });
    const now = Date.now();

    const match = dividends.find(
      (d) =>
        Math.abs(parseFloat(d.amount) - delta) < 0.0001 &&
        Math.abs(d.divTime - now) < 5 * 60 * 1000 // within 5 minutes
    );

    if (!match) {
      log.info(`${asset} deposit is NOT a reward (user buy/transfer). Skipping.`);
      return;
    }

    if (isRewardProcessed(match.tranId)) {
      log.info(`Reward ${match.tranId} already processed. Skipping.`);
      return;
    }

    const source = this.classifySource(match.enInfo);
    log.info(`Confirmed reward: ${match.amount} ${asset} from ${source}`);

    // Sell to USDT
    const usdtAmount = await this.sellToUsdt(asset, parseFloat(match.amount));

    // Record in DB
    insertReward({
      timestamp: new Date().toISOString(),
      source,
      asset,
      amount: parseFloat(match.amount),
      tran_id: match.tranId,
      converted_to: usdtAmount > 0 ? 'USDT' : null,
      converted_amount: usdtAmount > 0 ? usdtAmount : null,
    });

    if (usdtAmount > 0) {
      this.notify(`🦞 Sold ${parseFloat(match.amount)} ${asset} (${source}) → $${usdtAmount.toFixed(2)} USDT`);
    }
  }

  // ── Heartbeat: sweep idle BNB + catch missed rewards ───

  async heartbeat(): Promise<void> {
    await this.sweepIdleBnb();
    await this.sweepFundingBnb();
    await this.catchMissedRewards();
  }

  private async sweepIdleBnb(): Promise<void> {
    try {
      const { free } = await this.client.getSpotBalance('BNB');
      if (free > 0.001) {
        await this.client.subscribeEarn('BNB', free);
        log.info(`Swept ${free} idle BNB from spot to Simple Earn`);
        this.notify(`🦞 Found ${free.toFixed(4)} BNB in spot → moved to Simple Earn.`);
      }
    } catch (err) {
      log.error('Failed to sweep BNB to earn', err);
    }
  }

  private async sweepFundingBnb(): Promise<void> {
    try {
      const funding = await this.client.getFundingBalance('BNB');
      const bnb = funding.find(b => b.asset === 'BNB');
      const free = parseFloat(bnb?.free ?? '0');
      if (free > 0.001) {
        // Transfer funding → spot, then spot → earn
        await this.client.universalTransfer('FUNDING_MAIN', 'BNB', free);
        await this.client.subscribeEarn('BNB', free);
        log.info(`Swept ${free} BNB from funding → Simple Earn`);
        this.notify(`🦞 Found ${free.toFixed(4)} BNB in funding wallet → moved to Simple Earn.`);
      }
    } catch (err) {
      log.error('Failed to sweep funding BNB', err);
    }
  }

  private async catchMissedRewards(): Promise<void> {
    try {
      const dividends = await this.client.getAssetDividend({ limit: 20 });

      for (const div of dividends) {
        if (isRewardProcessed(div.tranId)) continue;

        const amount = parseFloat(div.amount);
        const source = this.classifySource(div.enInfo);

        // Record in DB
        insertReward({
          timestamp: new Date(div.divTime).toISOString(),
          source,
          asset: div.asset,
          amount,
          tran_id: div.tranId,
          converted_to: null,
          converted_amount: null,
        });

        // Notify on notable distributions
        if (source === 'AIRDROP' || source === 'LAUNCHPOOL') {
          this.notify(
            `🎁 New ${div.enInfo}: +${div.amount} ${div.asset}\n` +
            `Use "convert ${div.asset}" to sell to USDT, or "convert ${div.asset} BNB" to convert to BNB.`
          );
        } else if (div.asset !== 'BNB' && div.asset !== 'USDT') {
          this.notify(
            `🦞 New distribution: +${div.amount} ${div.asset} (${div.enInfo})\n` +
            `Use "convert ${div.asset}" to sell.`
          );
        }
      }
    } catch (err) {
      log.error('Failed to catch missed rewards', err);
    }
  }

  // ── Sell to USDT ───────────────────────────────────────

  private async sellToUsdt(asset: string, amount: number): Promise<number> {
    if (asset === 'USDT') return amount; // Already USDT
    try {
      // Try spot market first
      const pairExists = await this.client.getExchangeInfo(`${asset}USDT`);
      if (pairExists) {
        const order = await this.client.placeSpotOrder('SELL', amount, `${asset}USDT`);
        const received = parseFloat(order.executedQty) * parseFloat(order.avgPrice);
        log.info(`Sold ${amount} ${asset} via spot → ${received} USDT`);
        return received;
      }

      // Fallback: Binance Convert API
      const quote = await this.client.getConvertQuote(asset, 'USDT', amount);
      const result = await this.client.acceptConvertQuote(quote.quoteId);
      const received = parseFloat(quote.toAmount);
      log.info(`Sold ${amount} ${asset} via Convert → ${received} USDT`);
      return received;
    } catch (err) {
      log.error(`Failed to sell ${asset} to USDT`, err);
      return 0;
    }
  }

  // ── Dust Cleanup (weekly) ──────────────────────────────
  // IMPORTANT: Only converts truly tiny leftover dust to BNB.
  // Airdrop and Launchpool tokens are sold to USDT first by catchMissedRewards().

  async cleanupDust(): Promise<void> {
    // First, sell any unclaimed airdrop/launchpool rewards to USDT
    await this.catchMissedRewards();

    try {
      // Get dust-eligible assets, but exclude any that were just received
      // as rewards (those should already be sold to USDT above)
      const recentDividends = await this.client.getAssetDividend({ limit: 20 });
      const recentRewardAssets = new Set(
        recentDividends
          .filter(d => {
            const source = this.classifySource(d.enInfo);
            return source === 'AIRDROP' || source === 'LAUNCHPOOL' || source === 'DISTRIBUTION';
          })
          .map(d => d.asset)
      );

      const result = await this.client.convertSmallBalance(recentRewardAssets);
      const bnb = parseFloat(result.totalServiceChargeInBNB || '0');
      if (bnb > 0) {
        log.info(`Dust cleanup: converted to ${bnb} BNB`);
        this.notify(`🦞 Dust cleanup: small balances → ${bnb.toFixed(6)} BNB`);
      }
    } catch (err) {
      log.error('Dust cleanup failed', err);
    }
  }

  // ── Helpers ────────────────────────────────────────────

  private classifySource(enInfo: string): RewardSource {
    const lower = enInfo.toLowerCase();
    if (lower === 'launchpool') return 'LAUNCHPOOL';
    if (lower.includes('airdrop') || lower.includes('hodler')) return 'AIRDROP';
    if (lower === 'flexible' || lower === 'locked' || lower === 'bnb vault') return 'EARN_INTEREST';
    return 'DISTRIBUTION';
  }
}
