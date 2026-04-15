import type { BinanceClient } from '../api/binance-client.js';
import type { AssetDividend } from '../api/types.js';
import {
  getRewardByTranId,
  insertReward,
  updateRewardConversion,
} from '../db/queries.js';
import { createLogger } from '../utils/logger.js';
import {
  classifySource,
  sellToUsdt,
  shouldAutoConvertReward,
} from '../utils/reward-helpers.js';

const log = createLogger('earn-manager');

export interface RewardSyncSummary {
  scanned: number;
  newlyRecorded: number;
  convertedCount: number;
  convertedUsdt: number;
  pendingCount: number;
  skippedCount: number;
}

export interface DustCleanupSummary {
  convertedBnb: number;
  feeBnb: number;
  assets: string[];
}

type RewardOutcome = 'converted' | 'pending' | 'recorded' | 'skipped';

export class EarnManager {
  private client: BinanceClient;
  private notify: (msg: string) => void;

  constructor(client: BinanceClient, notify: (msg: string) => void) {
    this.client = client;
    this.notify = notify;
  }

  async onBalanceUpdate(asset: string, delta: number): Promise<void> {
    if (asset === 'BNB' || asset === 'USDT' || delta <= 0) return;

    log.info(`Balance update: +${delta} ${asset}, verifying if reward...`);

    const dividends = await this.client.getAssetDividend({ asset, limit: 5 });
    const now = Date.now();

    const match = dividends.find((dividend) =>
      Math.abs(parseFloat(dividend.amount) - delta) < 0.0001 &&
      Math.abs(dividend.divTime - now) < 5 * 60 * 1000,
    );

    if (!match) {
      log.info(`${asset} deposit is not a reward. Skipping.`);
      return;
    }

    await this.processDividend(match, true);
  }

  async heartbeat(): Promise<void> {
    await this.sweepIdleBnb();
    await this.sweepFundingBnb();
    await this.syncRecentRewards();
  }

  async syncRecentRewards(options: {
    limit?: number;
    startTime?: number;
    notify?: boolean;
  } = {}): Promise<RewardSyncSummary> {
    const notify = options.notify ?? true;
    const dividends = await this.client.getAssetDividend({
      limit: options.limit ?? 100,
      startTime: options.startTime,
    });

    const summary: RewardSyncSummary = {
      scanned: dividends.length,
      newlyRecorded: 0,
      convertedCount: 0,
      convertedUsdt: 0,
      pendingCount: 0,
      skippedCount: 0,
    };

    for (const dividend of dividends.sort((left, right) => left.divTime - right.divTime)) {
      const existing = getRewardByTranId(dividend.tranId);
      const outcome = await this.processDividend(dividend, notify);

      if (!existing && outcome !== 'skipped') {
        summary.newlyRecorded++;
      }

      if (outcome === 'converted') {
        const updated = getRewardByTranId(dividend.tranId);
        summary.convertedCount++;
        summary.convertedUsdt += updated?.converted_amount ?? 0;
      } else if (outcome === 'pending') {
        summary.pendingCount++;
      } else if (outcome === 'skipped') {
        summary.skippedCount++;
      }
    }

    return summary;
  }

  async cleanupDust(options: { notify?: boolean } = {}): Promise<DustCleanupSummary> {
    const notify = options.notify ?? true;

    // Keep recent Launchpool/HODLer rewards away from dust conversion while
    // they are being sold to USDT through the reward sync path.
    await this.syncRecentRewards({ notify: false });

    const recentDividends = await this.client.getAssetDividend({ limit: 100 });
    const recentRewardAssets = new Set(
      recentDividends
        .filter((dividend) => shouldAutoConvertReward(classifySource(dividend.enInfo), dividend.asset))
        .map((dividend) => dividend.asset),
    );

    const result = await this.client.convertSmallBalance(recentRewardAssets, 'BNB');
    const convertedBnb = parseFloat(result.totalTransfered || '0');
    const feeBnb = parseFloat(result.totalServiceCharge || '0');

    if (notify && convertedBnb > 0) {
      const assetList = result.assets.length > 0 ? result.assets.join(', ') : 'dust balances';
      this.notify(
        `Dust cleanup: ${assetList} -> ${convertedBnb.toFixed(8)} BNB` +
        (feeBnb > 0 ? ` (fee ${feeBnb.toFixed(8)} BNB)` : ''),
      );
    }

    return { convertedBnb, feeBnb, assets: result.assets };
  }

  private async processDividend(dividend: AssetDividend, notify: boolean): Promise<RewardOutcome> {
    const amount = parseFloat(dividend.amount);
    const source = classifySource(dividend.enInfo);
    const existing = getRewardByTranId(dividend.tranId);
    const autoConvert = shouldAutoConvertReward(source, dividend.asset);

    if (existing && (!autoConvert || existing.converted_to)) {
      return 'skipped';
    }

    let usdtAmount = 0;
    if (autoConvert) {
      usdtAmount = await sellToUsdt(this.client, dividend.asset, amount);
    }

    if (!existing) {
      insertReward({
        timestamp: new Date(dividend.divTime).toISOString(),
        source,
        asset: dividend.asset,
        amount,
        tran_id: dividend.tranId,
        converted_to: usdtAmount > 0 ? 'USDT' : null,
        converted_amount: usdtAmount > 0 ? usdtAmount : null,
      });
    } else if (usdtAmount > 0) {
      updateRewardConversion(dividend.tranId, 'USDT', usdtAmount);
    }

    if (usdtAmount > 0) {
      if (notify) {
        this.notify(
          `Auto-converted ${amount} ${dividend.asset} (${dividend.enInfo}) -> $${usdtAmount.toFixed(2)} USDT`,
        );
      }
      return 'converted';
    }

    if (autoConvert) {
      if (notify && !existing) {
        this.notify(
          `Launchpool/HODLer reward detected: +${dividend.amount} ${dividend.asset}. ` +
          'Auto-convert to USDT failed, so it will be retried later.',
        );
      }
      return 'pending';
    }

    if (notify && !existing && dividend.asset !== 'BNB' && dividend.asset !== 'USDT') {
      this.notify(`New distribution: +${dividend.amount} ${dividend.asset} (${dividend.enInfo})`);
    }

    return existing ? 'skipped' : 'recorded';
  }

  private async sweepIdleBnb(): Promise<void> {
    try {
      const { free } = await this.client.getSpotBalance('BNB');
      if (free > 0.001) {
        await this.client.subscribeEarn('BNB', free, { sourceAccount: 'SPOT' });
        log.info(`Swept ${free} idle BNB from spot to Simple Earn`);
        this.notify(`Found ${free.toFixed(4)} BNB in spot -> moved to Simple Earn.`);
      }
    } catch (err) {
      log.error('Failed to sweep BNB to earn', err);
    }
  }

  private async sweepFundingBnb(): Promise<void> {
    try {
      const funding = await this.client.getFundingBalance('BNB');
      const bnb = funding.find((balance) => balance.asset === 'BNB');
      const free = parseFloat(bnb?.free ?? '0');
      if (free > 0.001) {
        await this.client.subscribeEarn('BNB', free, { sourceAccount: 'FUND' });
        log.info(`Swept ${free} BNB from funding to Simple Earn`);
        this.notify(`Found ${free.toFixed(4)} BNB in funding wallet -> moved to Simple Earn.`);
      }
    } catch (err) {
      log.error('Failed to sweep funding BNB', err);
    }
  }
}
